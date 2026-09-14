"""用 Bangumi（bgm.tv，中文二次元 wiki）补全角色的中文名、中文简介与中文作品名。

流程（每个角色 1~2 次请求，礼貌限速 ≈1.05s/次，可随时中断重跑）：
  1. 用日文原名 / 罗马音检索 Bangumi 角色；
  2. 打分匹配（名字完全一致 + 生日一致 + 有中文名），保守拒绝低置信度结果；
  3. 命中后抓取该角色的关联作品（含中文作品名），写入 raw/bangumi.jsonl。

之后重新执行 build_dataset.py 即会把中文信息合并进数据集。
"""

from __future__ import annotations

import json
import os
import re
import sys
import time

from common import RAW, append_jsonl, log, norm_name, norm_space, read_jsonl

SEARCH_API = "https://api.bgm.tv/v0/search/characters"
CHAR_API = "https://api.bgm.tv/v0/characters/{id}"
SUBJECTS_API = "https://api.bgm.tv/v0/characters/{id}/subjects"
OUT = os.path.join(RAW, "bangumi.jsonl")
QUEUE = os.path.join(RAW, "bangumi_queue.json")

LIMIT = int(os.environ.get("BANGUMI_LIMIT", "1000"))
SLEEP = float(os.environ.get("BANGUMI_SLEEP", "1.05"))  # 并发模式下设 BANGUMI_SLEEP=0，改由令牌桶限速
MIN_SCORE = float(os.environ.get("BANGUMI_MIN_SCORE", "3.0"))

CN_KEYS = ("简体中文名", "中文名", "簡體中文名")


def post(url: str, payload: dict):
    from common import post_json

    return post_json(url, payload, timeout=40)


def get(url: str):
    from common import get_json

    return get_json(url, timeout=40)


def infobox_map(infobox: list | None) -> dict[str, object]:
    out: dict[str, object] = {}
    for item in infobox or []:
        if isinstance(item, dict) and item.get("key"):
            out[str(item["key"])] = item.get("value")
    return out


def as_list(value: object) -> list[str]:
    if isinstance(value, list):
        out = []
        for v in value:
            if isinstance(v, dict):
                out.append(str(v.get("v") or v.get("value") or ""))
            else:
                out.append(str(v))
        return [x for x in out if x]
    if value:
        return [str(value)]
    return []


def cand_names(cand: dict) -> list[str]:
    names = [cand.get("name") or ""]
    box = infobox_map(cand.get("infobox"))
    for key in CN_KEYS:
        names += as_list(box.get(key))
    names += as_list(box.get("别名"))
    return [n for n in names if n]


def score_candidate(cand: dict, item: dict) -> tuple[float, dict]:
    key = norm_name(item.get("key"))
    romaji = norm_name(item.get("romaji"))
    names = cand_names(cand)
    norms = {norm_name(n) for n in names}
    s = 0.0
    why = []
    if key and key in norms:
        s += 3.0
        why.append("name")
    elif romaji and romaji in norms:
        s += 2.2
        why.append("romaji")
    elif key and any(n.startswith(key) or key.startswith(n) for n in norms if len(n) > 1):
        s += 1.6
        why.append("prefix")
    if cand.get("birth_mon") and cand.get("birth_day"):
        if int(cand["birth_mon"]) == int(item["month"]) and int(cand["birth_day"]) == int(item["day"]):
            s += 1.6
            why.append("birth")
        else:
            s -= 3.5
            why.append("birth-mismatch")
    cn = infobox_map(cand.get("infobox"))
    if any(as_list(cn.get(k)) for k in CN_KEYS):
        s += 0.4
        why.append("has-cn")
    collects = int(((cand.get("stat") or {}) or {}).get("collects") or 0)
    if collects >= 30:
        s += 0.3
    if str(cand.get("type")) == "2":  # 2 = 现实人物
        s -= 5.0
    return s, {"why": why, "name": cand.get("name"), "collects": collects}


def build_work_cache() -> dict[str, str]:
    """从已有补全结果里汇总「作品原名 → 中文名」，避免重复查询同一部作品。"""
    cache: dict[str, str] = {}
    for rec in read_jsonl(OUT):
        for w in rec.get("works") or []:
            cn = w.get("name_cn")
            if not cn:
                continue
            for key in (w.get("name"), ):
                n = norm_name(key)
                if n:
                    cache.setdefault(n, cn)
    return cache


def enrich_one(item: dict, work_cache: dict[str, str] | None = None) -> dict:
    key = item.get("key") or item.get("romaji")
    out = {"key": item.get("key") or key, "matched": False, "src_id": item.get("id"), "tried_at": time.strftime("%Y-%m-%d")}
    if not key:
        return out
    try:
        res = post(SEARCH_API, {"keyword": key, "limit": 10}) or {}
    except Exception as e:  # noqa: BLE001
        log(f"  ! 搜索失败 {key}: {e}")
        return out
    time.sleep(SLEEP)
    cands = [c for c in (res.get("data") or []) if str(c.get("type")) in ("1", "None", "none") or c.get("type") == 1]
    best, best_score, best_why = None, 0.0, {}
    for cand in cands:
        sc, why = score_candidate(cand, item)
        if sc > best_score:
            best, best_score, best_why = cand, sc, why
    if not best or best_score < MIN_SCORE:
        out["score"] = round(best_score, 2)
        out["why"] = best_why.get("why", [])
        return out

    box = infobox_map(best.get("infobox"))
    name_cn = next((as_list(box.get(k))[0] for k in CN_KEYS if as_list(box.get(k))), "")
    images = best.get("images") or {}
    works = []
    need_subjects = True
    if work_cache:
        titles = [norm_name(t) for t in (item.get("works") or []) if t]
        covered = [t for t in titles if t in work_cache]
        if titles and len(covered) == len(titles):
            need_subjects = False  # 这部作品的中文名已经查过，直接复用
    subs = []
    if need_subjects:
        try:
            subs = get(SUBJECTS_API.format(id=best.get("id"))) or []
        except Exception:  # noqa: BLE001
            subs = []
        time.sleep(SLEEP)
        for s in subs[:8]:
            if work_cache is not None and s.get("name") and s.get("name_cn"):
                work_cache.setdefault(norm_name(s["name"]), s["name_cn"])
    else:
        out["works_cached"] = True
        for t in item.get("works") or []:
            cn = work_cache.get(norm_name(t))
            if cn:
                works.append({"id": None, "name": t, "name_cn": cn, "type": None, "staff": "", "image": ""})
    for s in subs[:8]:
        works.append(
            {
                "id": s.get("id"),
                "name": s.get("name") or "",
                "name_cn": s.get("name_cn") or "",
                "type": s.get("type"),
                "staff": s.get("staff") or "",
                "image": s.get("image") or "",
            }
        )
    stat = best.get("stat") or {}
    out.update(
        {
            "matched": True,
            "score": round(best_score, 2),
            "why": best_why.get("why", []),
            "bgm_id": best.get("id"),
            "bgm_name": best.get("name") or "",
            "name_cn": name_cn,
            "aliases": as_list(box.get("别名"))[:6],
            "gender": best.get("gender") or "",
            "blood_type": best.get("blood_type") or "",
            "birth": [best.get("birth_mon"), best.get("birth_day")],
            "summary": norm_space((best.get("summary") or "").replace("\r", " ").replace("\n", " "))[:400],
            "image": images.get("large") or images.get("medium") or "",
            "image_medium": images.get("medium") or images.get("large") or "",
            "collects": stat.get("collects") or 0,
            "comments": stat.get("comments") or 0,
            "nsfw": bool(best.get("nsfw")),
            "works": works,
        }
    )
    return out


CN_OK = ("bgm.tv", "moegirl.org.cn", "biligame.com")


def _is_cn(url: str) -> bool:
    return bool(url) and any(d in url for d in CN_OK)


def load_cn_image_targets(limit: int) -> list[dict]:
    """挑出「主图在大陆打不开、且没有大陆备用图」的条目（按人气降序）。

    补到 Bangumi 的图（lain.bgm.tv，国内可直连）后，构建期的「大陆优先」排序
    会自动把它提为主图；这也是目前大陆网络下最稳的图源。
    """
    import csv
    import glob

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out: list[dict] = []
    for path in sorted(glob.glob(os.path.join(root, "public", "data", "days", "*.csv"))):
        with open(path, encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                if _is_cn(r["image"] or r["thumb"]):
                    continue
                if any(_is_cn(a) for a in (r["alts"] or "").split("|") if a):
                    continue
                key = r["name_native"] or r["name_romaji"] or r["name_cn"]
                if not key:
                    continue
                out.append({
                    "id": r["id"], "key": key, "romaji": r["name_romaji"],
                    "month": int(r["month"]), "day": int(r["day"]), "src": r["src"],
                    "heat": int(r["heat"] or 0),
                    "works": [w for w in (r["work"], r["work_cn"]) if w],
                })
    out.sort(key=lambda x: -x["heat"])
    return out[:limit]


def _run_cn_images(targets: list[dict], workers: int, rps: float) -> int:
    """并发给「缺大陆可直连图源」的条目补 Bangumi 图（lain.bgm.tv 国内可直连）。"""
    import threading

    from parallel import RateLimiter, parallel_map

    done = {norm_name(r.get("key")) for r in read_jsonl(OUT) if r.get("matched")}
    todo = [t for t in targets if norm_name(t.get("key")) not in done]
    log(f"  CN 图源：队列 {len(targets)}，已命中 {len(done)}，本次处理 {len(todo)}")
    if not todo:
        return 0
    work_cache = build_work_cache()
    limiter = RateLimiter(rps=rps)
    lock = threading.Lock()
    stat = {"hit": 0, "img": 0}

    def work(item: dict):
        limiter.acquire()
        rec = enrich_one(item, work_cache)
        if rec.get("matched"):
            with lock:
                append_jsonl(OUT, rec)
                stat["hit"] += 1
                if rec.get("image"):
                    stat["img"] += 1
        return rec

    parallel_map(todo, work, workers=workers, limiter=limiter, progress_every=25,
                 on_progress=lambda d, t, ok: log(f"    进度 {d}/{t}  命中 {stat['hit']}（含图 {stat['img']}）"))
    log(f"  CN 图源完成：命中 {stat['hit']}，其中拿到图 {stat['img']} → {OUT}")
    return 0


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=int(os.environ.get("BANGUMI_LIMIT", "1000")))
    ap.add_argument("--workers", type=int, default=int(os.environ.get("BANGUMI_WORKERS", "5")))
    ap.add_argument("--rps", type=float, default=float(os.environ.get("BANGUMI_RPS", "4")))
    ap.add_argument("--cn-images", action="store_true",
                    help="只补「主图在大陆打不开」的条目（补的是图片，不是中文名）")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.cn_images:
        targets = load_cn_image_targets(max(args.limit * 3, args.limit))
        log(f"CN 图源补全：候选 {len(targets)} 个缺大陆图的条目"
            f"（并发 {args.workers} 线程 / {args.rps} req/s）")
        if args.dry_run:
            for t in targets[:8]:
                log(f"   {t['key']}  {t['month']}/{t['day']}  heat={t['heat']}")
            return 0
        return _run_cn_images(targets[: args.limit], args.workers, args.rps)

    if not os.path.exists(QUEUE):
        log(f"缺少 {QUEUE}，请先执行 build_dataset.py")
        return 1
    with open(QUEUE, encoding="utf-8") as fh:
        queue = json.load(fh)
    done_keys: set[str] = set()
    tried = 0
    for rec in read_jsonl(OUT):
        if not rec.get("matched"):
            tried += 1
            continue  # 未命中的条目允许换规则重试（队列按热度排序，先重试人气高的）
        done_keys.add(norm_name(rec.get("key")))
        if rec.get("bgm_name"):
            done_keys.add(norm_name(rec.get("bgm_name")))
    todo = [item for item in queue if norm_name(item.get("key")) not in done_keys]
    todo.sort(key=lambda i: -(i.get("heat") or 0))
    todo = todo[:LIMIT]
    log(f"Bangumi 补全：队列 {len(queue)} 条，已命中 {len(done_keys)} 条，历史未命中 {tried} 条（本轮会重试），本次处理 {len(todo)} 条（限速 {SLEEP}s/请求）")
    if not todo:
        return 0
    hits = 0
    work_cache = build_work_cache()
    log(f"  作品中文名缓存：{len(work_cache)} 条")
    for i, item in enumerate(todo, 1):
        rec = enrich_one(item, work_cache)
        append_jsonl(OUT, rec)
        hits += 1 if rec.get("matched") else 0
        if i % 10 == 0 or i == len(todo):
            log(f"  进度 {i}/{len(todo)}  命中 {hits}  最近：{item.get('key')} → {rec.get('name_cn') or '（未命中）'}  score={rec.get('score')}")
    log(f"Bangumi 补全完成：命中 {hits}/{len(todo)}，累计缓存 {len(done_keys) + len(todo)} 条 → {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
