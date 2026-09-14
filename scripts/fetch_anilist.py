"""从 AniList GraphQL 抓取「有生日」的二次元角色（动画 / 漫画 / 轻小说 / 游戏改编）。

策略：
1. 按收藏数（人气）从高到低分页遍历角色库，保留 dateOfBirth 有月日的角色；
2. 再对热门作品逐个抓取 cast，补齐主角之外的配角（保证每一天都有足够角色）。

输出：raw/anilist.jsonl（每行一个角色）
可重复执行；已抓取的页/作品会跳过（增量）。
"""

from __future__ import annotations

import os
import sys
import time

from common import RAW, append_jsonl, ensure_dirs, get_json, log, post_json, progress, read_jsonl, strip_html

API = "https://graphql.anilist.co"
OUT = os.path.join(RAW, "anilist.jsonl")
STATE = os.path.join(RAW, ".anilist_state.json")

PAGE_SIZE = 50
MAX_PAGES = int(os.environ.get("ANILIST_MAX_PAGES", "110"))  # AniList 分页上限 5000 条
TOP_MEDIA = int(os.environ.get("ANILIST_TOP_MEDIA", "400"))  # 额外抓取的热门作品数量
SLEEP = float(os.environ.get("ANILIST_SLEEP", "1.1"))

CHAR_FIELDS = """
  id
  name { full native alternative }
  dateOfBirth { year month day }
  gender
  age
  bloodType
  favourites
  description(asHtml: false)
  image { large medium }
  siteUrl
  media(sort: POPULARITY_DESC, perPage: 8) {
    nodes { id type format title { romaji native english } startDate { year } popularity genres }
  }
"""

Q_CHARS = f"""
query ($page: Int, $perPage: Int) {{
  Page(page: $page, perPage: $perPage) {{
    pageInfo {{ total currentPage lastPage hasNextPage }}
    characters(sort: FAVOURITES_DESC) {{ {CHAR_FIELDS} }}
  }}
}}
"""

Q_CAST = f"""
query ($id: Int) {{
  Media(id: $id) {{
    id
    title {{ romaji native english }}
    type format startDate {{ year }} popularity
    characters(sort: [ROLE, RELEVANCE, ID], perPage: 30) {{
      edges {{ role node {{ {CHAR_FIELDS} }} }}
    }}
  }}
}}
"""

Q_TOP_MEDIA = """
query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage currentPage }
    media(sort: POPULARITY_DESC, type: ANIME) { id title { romaji } popularity }
  }
}
"""


def gql(query: str, variables: dict) -> dict:
    """带限速的 GraphQL 调用。"""
    for attempt in range(6):
        try:
            data = post_json(API, {"query": query, "variables": variables})
        except Exception as e:  # noqa: BLE001
            log(f"  ! GraphQL 失败：{e}")
            time.sleep(min(60.0, 3.0 * (attempt + 1)))
            continue
        if isinstance(data, dict) and "errors" in data and "data" not in data:
            raise RuntimeError(f"GraphQL error: {data['errors']}")
        time.sleep(SLEEP)
        return data.get("data") or {}
    raise RuntimeError("GraphQL 连续失败")


def normalize_char(node: dict, fallback_media: dict | None = None) -> dict | None:
    dob = node.get("dateOfBirth") or {}
    month, day = dob.get("month"), dob.get("day")
    if not month or not day:
        return None
    media_nodes = ((node.get("media") or {}).get("nodes")) or []
    if fallback_media and not media_nodes:
        media_nodes = [fallback_media]
    works = []
    for m in media_nodes[:6]:
        if not m:
            continue
        title = m.get("title") or {}
        works.append(
            {
                "id": m.get("id"),
                "title": title.get("native") or title.get("romaji") or title.get("english") or "",
                "title_romaji": title.get("romaji") or "",
                "title_en": title.get("english") or "",
                "type": m.get("type") or "",
                "format": m.get("format") or "",
                "year": ((m.get("startDate") or {}).get("year")) or None,
                "popularity": m.get("popularity") or 0,
            }
        )
    works.sort(key=lambda w: -(w.get("popularity") or 0))
    name = node.get("name") or {}
    image = node.get("image") or {}
    return {
        "source": "anilist",
        "source_id": str(node.get("id")),
        "name_native": name.get("native") or "",
        "name_romaji": name.get("full") or "",
        "alt_names": name.get("alternative") or [],
        "month": int(month),
        "day": int(day),
        "year": dob.get("year"),
        "gender": node.get("gender") or "",
        "age": node.get("age") or "",
        "blood_type": node.get("bloodType") or "",
        "favourites": node.get("favourites") or 0,
        "summary": strip_html(node.get("description"))[:600],
        "image": image.get("large") or image.get("medium") or "",
        "image_medium": image.get("medium") or image.get("large") or "",
        "url": node.get("siteUrl") or f"https://anilist.co/character/{node.get('id')}",
        "works": works,
        "raw_type": (media_nodes[0].get("type") if media_nodes else "") or "",
    }


def main() -> None:
    ensure_dirs()
    seen_pages: set[int] = set()
    seen_ids: set[str] = set()
    if os.path.exists(OUT):
        for rec in read_jsonl(OUT):
            seen_ids.add(rec["source_id"])
    if os.path.exists(STATE):
        import json

        with open(STATE, encoding="utf-8") as fh:
            st = json.load(fh)
        seen_pages = set(st.get("pages", []))
        done_media = set(st.get("media", []))
        exhausted = bool(st.get("exhausted"))
    else:
        done_media = set()
        exhausted = False
    log(f"AniList：已有 {len(seen_ids)} 个角色，{len(seen_pages)} 页，{len(done_media)} 部作品"
        + ("（角色库分页已到底）" if exhausted else ""))

    # ── 第一步：按人气分页扫描角色库 ──────────────────────────────
    for page in range(1, MAX_PAGES + 1):
        if exhausted or page in seen_pages:
            continue
        try:
            data = gql(Q_CHARS, {"page": page, "perPage": PAGE_SIZE})
        except Exception as e:  # noqa: BLE001  # AniList 分页上限（5000 条）后返回 400，属正常结束
            log(f"第 {page} 页不可用（{e}），视为角色库扫描结束（已记入状态，下次不再探测）")
            exhausted = True
            _save_state(seen_pages, done_media, exhausted)
            break
        chars = ((data.get("Page") or {}).get("characters")) or []
        if not chars:
            log(f"第 {page} 页为空，结束角色扫描")
            break
        added = 0
        for node in chars:
            rec = normalize_char(node)
            if rec and rec["source_id"] not in seen_ids:
                seen_ids.add(rec["source_id"])
                append_jsonl(OUT, rec)
                added += 1
        seen_pages.add(page)
        _save_state(seen_pages, done_media)
        info = (data.get("Page") or {}).get("pageInfo") or {}
        progress(page, MAX_PAGES, f"page={page} 新增 {added} 累计 {len(seen_ids)} total={info.get('total')}")
        if not info.get("hasNextPage"):
            break

    # ── 第二步：热门作品的完整 cast，补齐配角 ──────────────────────
    media_ids: list[dict] = []
    for page in range(1, 9):
        data = gql(Q_TOP_MEDIA, {"page": page, "perPage": 50})
        media_ids.extend(((data.get("Page") or {}).get("media")) or [])
        if len(media_ids) >= TOP_MEDIA:
            break
    media_ids = media_ids[:TOP_MEDIA]
    log(f"AniList：开始补抓 {len(media_ids)} 部热门作品的 cast")
    for i, m in enumerate(media_ids, 1):
        mid = str(m.get("id"))
        if mid in done_media:
            continue
        data = gql(Q_CAST, {"id": m.get("id")})
        media = data.get("Media") or {}
        fallback = {
            "id": media.get("id"),
            "title": (media.get("title") or {}).get("native") or (media.get("title") or {}).get("romaji"),
            "type": media.get("type"),
            "format": media.get("format"),
            "startDate": media.get("startDate"),
            "popularity": media.get("popularity"),
        }
        edges = ((media.get("characters") or {}).get("edges")) or []
        added = 0
        for edge in edges:
            node = edge.get("node") or {}
            rec = normalize_char(node, fallback)
            if rec and rec["source_id"] not in seen_ids:
                seen_ids.add(rec["source_id"])
                append_jsonl(OUT, rec)
                added += 1
        done_media.add(mid)
        _save_state(seen_pages, done_media)
        progress(i, len(media_ids), f"作品 {added} 新增 累计 {len(seen_ids)}")
    log(f"AniList 完成：共 {len(seen_ids)} 个有生日的角色 → {OUT}")


def _save_state(pages: set[int], media: set[str], exhausted: bool = False) -> None:
    import json

    with open(STATE, "w", encoding="utf-8") as fh:
        json.dump({"pages": sorted(pages), "media": sorted(media), "exhausted": exhausted}, fh)


if __name__ == "__main__":
    sys.exit(main())
