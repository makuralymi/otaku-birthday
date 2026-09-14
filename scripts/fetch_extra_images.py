"""多源补图：给没有立绘的条目从其它网站找图（萌娘百科 / Fandom / VNDB）。

背景：Bangumi dump 只有文字，没有图片地址；本站有约 1 万条角色没有立绘。
本脚本按「准确度 vs 成本」分层，能批量的先批量，慢的放后面：

  ① 萌娘百科（zh.moegirl.org.cn）
     · prop=images 一次问 50 个条目的图片列表（1 请求覆盖 50 人）
     · 只保留文件名里含该角色名（中文名/原名/罗马音/别名）的候选，再批量查 imageinfo
     · 图片在 storage.moegirl.org.cn：可热链、带 CORS（浏览器能直接取色），
       缩略图后缀 `!/fw/400` 即可拿到 400px 版本
  ② Fandom（*.fandom.com）
     · prop=pageimages 一次问 50 个条目，直接给出「页面主图」（角色页的主图通常就是立绘）
     · 需要带 Referer（无 Referer 会 403），前端对 nocookie.net 会改用默认 referrer 策略
  ③ VNDB
     · 针对 GalGame / 视觉小说角色：按名字搜索，校验生日一致才采用，图最准
  ④ Bangumi 自己（交给 enrich_bangumi_ids.py，按角色 id 直查，最权威但 1 请求/角色）

结果写入 raw/images_extra.jsonl，build_dataset.py 会自动合并；可随时中断续跑。

用法：
  python3 scripts/fetch_extra_images.py --limit 2000           # 处理最热门的 2000 个缺图角色
  python3 scripts/fetch_extra_images.py --sources moegirl,fandom --limit 500
  python3 scripts/fetch_extra_images.py --dry-run --limit 100  # 只统计命中率
"""

from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import re
import threading
import sys
import time
from collections import defaultdict

from common import DATA, RAW, append_jsonl, log, norm_name, post_json, read_jsonl, request
from parallel import RateLimiter, parallel_map

OUT = os.path.join(RAW, "images_extra.jsonl")
UA = "otaku-birthday/1.0 (+https://github.com/makuralymi/otaku-birthday; makuraly@outlook.com)"
MOEGIRL_API = "https://zh.moegirl.org.cn/api.php"
FANDOM_API = "https://{wiki}.fandom.com/api.php"
VNDB_API = "https://api.vndb.org/kana/character"

# 作品名关键词 → Fandom 子域名（覆盖主流二次元游戏；命中即优先用 Fandom 的页面主图）
FANDOM_WIKIS = {
    "genshin-impact": ["原神", "genshin"],
    "honkai-star-rail": ["崩坏：星穹铁道", "崩坏星穹铁道", "star rail", "崩壊：スターレイル"],
    "honkai-impact-3rd": ["崩坏3", "崩壊3rd", "honkai impact"],
    "zenless-zone-zero": ["绝区零", "zenless"],
    "wuthering-waves": ["鸣潮", "wuthering waves"],
    "bluearchive": ["蔚蓝档案", "ブルーアーカイブ", "blue archive"],
    "arknights": ["明日方舟", "アークナイツ", "arknights"],
    "azurlane": ["碧蓝航线", "アズールレーン", "azur lane"],
    "umamusume": ["赛马娘", "ウマ娘", "umamusume"],
    "fategrandorder": ["Fate/Grand Order", "FGO"],
    "princess-connect": ["公主连结", "プリンセスコネクト", "princess connect"],
    "projectsekai": ["世界计划", "プロジェクトセカイ", "project sekai"],
    "the-idolmaster": ["偶像大师", "アイドルマスター", "idolmaster"],
    "girlsfrontline": ["少女前线", "少女前線"],
    "nikke": ["胜利女神", "ニケ"],
    "persona5": ["女神异闻录5", "persona 5"],
    "fireemblem": ["火焰之纹章", "ファイアーエムブレム", "fire emblem"],
    "finalfantasy": ["最终幻想", "ファイナルファンタジー", "final fantasy"],
    "danganronpa": ["弹丸论破", "ダンガンロンパ"],
    "pokemon": ["宝可梦", "ポケットモンスター", "pokémon", "pokemon"],
}

BAD_FILE = re.compile(r"(icon|logo|avatar|banner|bg|背景|图标|标志|头图|投稿|表情|徽章|svg$|ogg$|mp4$)", re.I)
IMG_EXT = re.compile(r"\.(jpg|jpeg|png|webp|gif)$", re.I)


def sleep(t: float = 1.15) -> None:
    time.sleep(t)


def api_get(url: str, params: dict) -> dict:
    from urllib.parse import urlencode

    full = f"{url}?{urlencode(params)}"
    body = request(full, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=45)
    return json.loads(body)


def name_tokens(char: dict) -> set[str]:
    """用于文件名匹配的名字片段"""
    toks = set()
    for field in ("name_cn", "name_native", "name_romaji", "alt_names"):
        v = char.get(field)
        values = v if isinstance(v, list) else [v]
        for item in values:
            n = norm_name(item or "")
            if len(n) >= 2:
                toks.add(n)
    return toks


# ─────────────────────────── ① 萌娘百科 ───────────────────────────


def title_variants(char: dict, prefer: str = "cn") -> list[str]:
    """一个角色在 wiki 上可能的条目标题：主名、别名、以及带作品名的消歧义写法。"""
    base = []
    fields = ("name_cn", "name_native", "name_romaji") if prefer == "cn" else ("name_romaji", "name_native", "name_cn")
    for f in fields:
        v = (char.get(f) or "").strip()
        if v:
            base.append(v)
    base += [(a or "").strip() for a in (char.get("alt_names") or [])[:2] if a]
    work = (char.get("work_cn") or "").strip() if prefer == "cn" else (char.get("work_romaji") or char.get("work") or "").strip()
    out = []
    for b in base:
        if b and b not in out:
            out.append(b)
        if work:
            for sep in ("(", "（"):
                cand = f"{b}{sep}{work})" if sep == "(" else f"{b}{sep}{work}）"
                if cand not in out:
                    out.append(cand)
    return out[:4]


def _chunk_titles(chars: list[dict], prefer: str, budget: int = 600, per_chunk: int = 12) -> list[tuple[list[str], dict]]:
    """把角色切成若干「标题块」：每块 ≤budget 字符、≤per_chunk 个角色（并发单位）。"""
    chunks: list[tuple[list[str], dict]] = []
    by_title: dict[str, dict] = {}
    titles: list[str] = []
    size = 0
    budget_used = 0

    def flush():
        nonlocal by_title, titles, size, budget_used
        if titles:
            chunks.append((titles, by_title))
        by_title, titles, size, budget_used = {}, [], 0, 0

    for c in chars:
        cand = [t for t in title_variants(c, prefer=prefer) if t not in by_title]
        if not cand:
            continue
        need = sum(len(t) + 1 for t in cand)
        if titles and (budget_used + need > budget or size >= per_chunk):
            flush()
        for t in cand:
            by_title[t] = c
            titles.append(t)
            budget_used += len(t) + 1
        size += 1
    flush()
    return chunks


def moegirl_resolve(chars: list[dict], width: int = 400, verbose=None, on_batch=None,
                    workers: int = 6, rps: float = 3.0) -> dict[str, dict]:
    """萌娘百科：批量问「页面主图」（并发 + 限速）。

    图片在 storage.moegirl.org.cn：可热链、带 CORS（浏览器能直接取色）；
    接口给的 thumbnail 就是 400px 版本，无需自己拼缩略图参数。
    """
    chunks = _chunk_titles(chars, prefer="cn")
    limiter = RateLimiter(rps=rps)
    out: dict[str, dict] = {}
    lock = threading.Lock()

    def work(chunk):
        titles, by_title = chunk
        data = None
        for attempt in range(3):
            limiter.acquire()
            try:
                data = api_get(MOEGIRL_API, {
                    "action": "query", "format": "json", "formatversion": "2",
                    "prop": "pageimages", "piprop": "original|thumbnail", "pithumbsize": str(width),
                    "titles": "|".join(titles),
                })
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 2:
                    log(f"    ! 萌百失败（{e}）")
                else:
                    time.sleep(2 + attempt * 3)
        if not data:
            return None
        got = {}
        for page in (data.get("query", {}) or {}).get("pages", []) or []:
            if page.get("missing"):
                continue
            char = by_title.get(page.get("title") or "")
            if not char:
                continue
            orig = (page.get("original") or {}).get("source") or ""
            thumb = (page.get("thumbnail") or {}).get("source") or orig
            if orig:
                got[char["id"]] = {"image": orig, "thumb": thumb, "source": "moegirl",
                                   "title": page.get("title")}
        return got

    def on_result(got):
        with lock:
            out.update({k: v for k, v in got.items() if k not in out})
            if on_batch:
                on_batch(dict(got))

    parallel_map(chunks, work, workers=workers, on_result=on_result,
                 on_progress=verbose, progress_every=10, label="moegirl")
    return out


def fandom_wiki_of(char: dict) -> str | None:
    """角色的主作品能对应到哪个 Fandom wiki（没有就返回 None，不做无谓请求）"""
    blob = " ".join([
        (char.get("work") or ""), (char.get("work_cn") or ""),
        " ".join((w.get("t", "") or "") + (w.get("cn", "") or "") for w in (char.get("works") or [])[:3]),
    ]).lower()
    for wiki, keys in FANDOM_WIKIS.items():
        if any(k.lower() in blob for k in keys):
            return wiki
    return None


def fandom_resolve(chars: list[dict], width: int = 400, verbose=None, on_batch=None,
                   workers: int = 6, rps: float = 4.0) -> dict[str, dict]:
    """Fandom：按作品映射到对应 wiki，并发批量问 pageimages（标题用罗马音/英文优先）。

    static.wikia.nocookie.net 要求带 Referer 才不 403（前端已按域名切换策略）；
    icon/card 类图不采用，宁可留空让别的源来补。
    """
    by_wiki: dict[str, list[dict]] = defaultdict(list)
    for c in chars:
        wiki = fandom_wiki_of(c)
        if wiki:
            by_wiki[wiki].append(c)

    jobs = []
    for wiki, items in by_wiki.items():
        for titles, by_title in _chunk_titles(items, prefer="en"):
            jobs.append((wiki, titles, by_title))

    limiter = RateLimiter(rps=rps)
    out: dict[str, dict] = {}
    lock = threading.Lock()

    def work(job):
        wiki, titles, by_title = job
        for attempt in range(2):
            limiter.acquire()
            try:
                data = api_get(FANDOM_API.format(wiki=wiki), {
                    "action": "query", "format": "json", "formatversion": "2",
                    "prop": "pageimages", "piprop": "thumbnail|original", "pithumbsize": str(width),
                    "titles": "|".join(titles),
                })
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 1:
                    log(f"    ! Fandom {wiki} 失败：{e}")
                data = None
        if not data:
            return None
        got = {}
        for page in (data.get("query", {}) or {}).get("pages", []) or []:
            char = by_title.get(page.get("title") or "")
            if not char or page.get("missing"):
                continue
            thumb = (page.get("thumbnail") or {}).get("source") or ""
            orig = (page.get("original") or {}).get("source") or thumb
            if not thumb or re.search(r"(icon|card|emblem|avatar|logo)", orig, re.I):
                continue
            got[char["id"]] = {"image": orig or thumb, "thumb": thumb,
                               "source": f"fandom:{wiki}", "title": page.get("title")}
        return got

    def on_result(got):
        with lock:
            out.update({k: v for k, v in got.items() if k not in out})
            if on_batch:
                on_batch(dict(got))

    parallel_map(jobs, work, workers=workers, on_result=on_result,
                 on_progress=verbose, progress_every=10, label="fandom")
    return out


# ─────────────────────────── ③ VNDB ───────────────────────────


def vndb_one(char: dict) -> dict | None:
    for name in title_variants(char, prefer="cn")[:2]:
        try:
            data = post_json(VNDB_API, {
                "filters": ["search", "=", name],
                "fields": "id,name,original,birthday,image.url",
                "results": 5,
            }, timeout=45) or {}
        except Exception:  # noqa: BLE001
            return None
        sleep(1.4)
        for hit in data.get("results") or []:
            bd = hit.get("birthday") or []
            if len(bd) == 2 and bd[0] == char["month"] and bd[1] == char["day"]:
                url = (hit.get("image") or {}).get("url")
                if url:
                    return {"image": url, "thumb": url, "source": "vndb", "title": hit.get("name")}
    return None


# ─────────────────────────── 主流程 ───────────────────────────


def load_missing(limit: int, only_types: set[str] | None = None) -> list[dict]:
    rows: list[dict] = []
    for path in sorted(glob.glob(os.path.join(DATA, "days", "*.csv"))):
        with open(path, encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                if r["image"]:
                    continue
                if only_types and not (set(r["types"].split("|")) & only_types):
                    continue
                rows.append({
                    "id": r["id"], "src": r["src"], "month": int(r["month"]), "day": int(r["day"]),
                    "name_cn": r["name_cn"], "name_native": r["name_native"], "name_romaji": r["name_romaji"],
                    "alt_names": [a for a in (r["alt_names"] or "").split(" / ") if a],
                    "types": r["types"].split("|"), "heat": int(r["heat"] or 0),
                    "work": r["work"], "work_cn": r["work_cn"],
                })
    rows.sort(key=lambda r: -r["heat"])
    return rows[:limit]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=2000)
    ap.add_argument("--sources", default="moegirl,fandom,vndb")
    ap.add_argument("--batch", type=int, default=50)
    ap.add_argument("--workers", type=int, default=6, help="并发线程数（每站点独立限速）")
    ap.add_argument("--rps", type=float, default=3.0, help="每站点请求速率上限")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    sources = [s.strip() for s in args.sources.split(",") if s.strip()]

    # 已命中的不再处理；未命中的允许再试一次（记 tries，避免无限重试）
    cached = read_jsonl(OUT)
    done = {r["id"] for r in cached if r.get("image")}
    done |= {r["id"] for r in cached if r.get("miss") and (r.get("tries") or 1) >= 2}
    tried = {r["id"]: (r.get("tries") or 1) for r in cached if r.get("miss")}
    todo = [c for c in load_missing(args.limit + len(done)) if c["id"] not in done][: args.limit]
    log(f"多源补图：缺图候选 {len(todo)} 个（已解决 {len(done)}），来源 {'/'.join(sources)}"
        f"，并发 {args.workers} 线程 / 每站点限速 {args.rps} req/s")
    if not todo:
        return 0

    resolved: dict[str, dict] = {}
    stats: dict[str, int] = defaultdict(int)
    t0 = time.time()

    def flush(new: dict[str, dict]) -> None:
        """每批立刻落盘：脚本可随时中断，已拿到的图不丢"""
        for cid, info in new.items():
            if cid not in resolved:
                append_jsonl(OUT, {"id": cid, **info})
        resolved.update(new)

    if "fandom" in sources:
        got = fandom_resolve(todo, verbose=lambda i, n, o=0: log(f"  fandom {i}/{n} 累计命中 {o}"),
                             on_batch=flush, workers=args.workers, rps=args.rps + 1)
        flush(got)
        stats["fandom"] += len(got)

    if "moegirl" in sources:
        rest = [c for c in todo if c["id"] not in resolved]
        got = moegirl_resolve(rest, verbose=lambda i, n, o=0: log(f"  moegirl {i}/{n} 累计命中 {o}"),
                              on_batch=flush, workers=args.workers, rps=args.rps)
        flush(got)
        stats["moegirl"] += len(got)

    if "vndb" in sources:
        rest = [c for c in todo if c["id"] not in resolved and ("Galgame" in c["types"] or "游戏" in c["types"])]
        rest = rest[: max(0, args.limit)]
        log(f"  vndb 逐个搜索 {len(rest)} 个（约 {len(rest)*1.5/60:.0f} 分钟）")
        for i, c in enumerate(rest, 1):
            got = vndb_one(c)
            if got:
                flush({c["id"]: got})
                stats["vndb"] += 1
            if i % 25 == 0:
                log(f"  vndb {i}/{len(rest)}  命中 {stats['vndb']}")

    if args.dry_run:
        log(f"[dry-run] 命中 {len(resolved)}/{len(todo)}：" +
            ", ".join(f"{k}={v}" for k, v in stats.items()))
        for cid, info in list(resolved.items())[:5]:
            log(f"   {cid} ← {info['source']}  {info['image'][:80]}")
        return 0

    # 记录未命中的，避免下次重复尝试
    for c in todo:
        if c["id"] not in resolved:
            append_jsonl(OUT, {"id": c["id"], "image": "", "source": "", "miss": True,
                               "tries": (tried.get(c["id"], 0) + 1)})
    log(f"完成：命中 {len(resolved)}/{len(todo)}（{time.time()-t0:.0f}s）"
        f" 明细 " + ", ".join(f"{k}={v}" for k, v in stats.items()) + f" → {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
