"""从 VNDB（The Visual Novel Database）抓取 GalGame / 视觉小说角色的生日数据。

VNDB 的 kana API 支持按 birthday 过滤，是 GalGame 侧最完整的公开数据源。
输出：raw/vndb.jsonl
"""

from __future__ import annotations

import os
import re
import sys
import time

from common import RAW, append_jsonl, ensure_dirs, log, post_json, progress, read_jsonl

API = "https://api.vndb.org/kana/character"
OUT = os.path.join(RAW, "vndb.jsonl")
STATE = os.path.join(RAW, ".vndb_state.json")

FIELDS = ",".join(
    [
        "id",
        "name",
        "original",
        "aliases",
        "birthday",
        "sex",
        "gender",
        "blood_type",
        "description",
        "image.url",
        "traits.name",
        "vns.id",
        "vns.title",
        "vns.alttitle",
        "vns.released",
        "vns.rating",
        "vns.votecount",
        "vns.developers.name",
    ]
)

MAX_PAGES = int(os.environ.get("VNDB_MAX_PAGES", "220"))
SLEEP = float(os.environ.get("VNDB_SLEEP", "1.5"))

BBCODE = re.compile(r"\[/?[a-z]+(=[^\]]*)?\]", re.I)
SPOILER = re.compile(r"\[spoiler\](.*?)\[/spoiler\]", re.I | re.S)


def clean_desc(text: str | None) -> str:
    if not text:
        return ""
    text = SPOILER.sub("", text)
    text = BBCODE.sub("", text)
    text = text.replace("\r", "")
    return re.sub(r"\n{3,}", "\n\n", text).strip()[:600]


def fetch_page(page: int) -> dict:
    payload = {
        "filters": ["birthday", "!=", None],
        "fields": FIELDS,
        "sort": "id",
        "results": 100,
        "page": page,
    }
    return post_json(API, payload, timeout=60)  # type: ignore[return-value]


def main() -> None:
    ensure_dirs()
    seen: set[str] = set()
    if os.path.exists(OUT):
        for rec in read_jsonl(OUT):
            seen.add(rec["source_id"])
    start_page = 1
    if os.path.exists(STATE):
        import json

        with open(STATE, encoding="utf-8") as fh:
            start_page = int(json.load(fh).get("next_page", 1))
    log(f"VNDB：已有 {len(seen)} 个角色，从第 {start_page} 页继续")

    page = start_page
    empty_streak = 0
    while page <= MAX_PAGES:
        try:
            data = fetch_page(page)
        except Exception as e:  # noqa: BLE001
            log(f"  ! 第 {page} 页失败：{e}")
            time.sleep(5)
            empty_streak += 1
            if empty_streak >= 3:
                break
            page += 1
            continue
        empty_streak = 0
        results = data.get("results") or []
        if not results:
            log(f"第 {page} 页为空，抓取结束")
            break
        added = 0
        for c in results:
            bd = c.get("birthday") or []
            if len(bd) != 2 or not bd[0] or not bd[1]:
                continue
            cid = str(c.get("id"))
            if cid in seen:
                continue
            works = []
            for vn in (c.get("vns") or [])[:8]:
                works.append(
                    {
                        "id": vn.get("id"),
                        "title": vn.get("title") or "",
                        "title_alt": vn.get("alttitle") or "",
                        "released": vn.get("released") or "",
                        "rating": vn.get("rating") or 0,
                        "votes": vn.get("votecount") or 0,
                        "staff": vn.get("role") or "",
                        "dev": ((vn.get("developers") or [{}])[0] or {}).get("name") or "",
                    }
                )
            works.sort(key=lambda w: (-(w.get("votes") or 0), -(w.get("rating") or 0)))
            seen.add(cid)
            append_jsonl(
                OUT,
                {
                    "source": "vndb",
                    "source_id": cid,
                    "name_romaji": c.get("name") or "",
                    "name_native": c.get("original") or "",
                    "alt_names": c.get("aliases") or [],
                    "month": int(bd[0]),
                    "day": int(bd[1]),
                    "year": None,
                    "gender": ",".join([s for s in (c.get("sex") or []) if s]) or (c.get("gender") or ""),
                    "blood_type": (c.get("blood_type") or "").upper(),
                    "favourites": max([w.get("votes") or 0 for w in works] or [0]),
                    "summary": clean_desc(c.get("description")),
                    "image": ((c.get("image") or {}) or {}).get("url") or "",
                    "image_medium": ((c.get("image") or {}) or {}).get("url") or "",
                    "url": f"https://vndb.org/{cid}",
                    "traits": [t.get("name") for t in (c.get("traits") or [])][:14],
                    "works": works,
                    "raw_type": "VN",
                },
            )
            added += 1
        with open(STATE, "w", encoding="utf-8") as fh:
            import json

            json.dump({"next_page": page + 1}, fh)
        progress(page, MAX_PAGES, f"page={page} 新增 {added} 累计 {len(seen)}")
        if not data.get("more"):
            log("服务端表示没有更多数据，结束")
            break
        time.sleep(SLEEP)
        page += 1
    log(f"VNDB 完成：共 {len(seen)} 个有生日的角色 → {OUT}")


if __name__ == "__main__":
    sys.exit(main())
