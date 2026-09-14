"""给 Bangumi dump 导入的角色补立绘与简介（按角色 id 直查，1 请求/角色）。

dump 里只有文字，没有图片地址；但我们已经知道每个角色的 Bangumi id，
直接 GET /v0/characters/{id} 比按名字搜索更准、更省（不需要匹配）。
限速 1.05s/请求，可中断续跑，结果写 raw/bangumi_images.jsonl，build_dataset.py 会自动合并。

用法：
  python3 scripts/enrich_bangumi_ids.py --limit 1500          # 补人气最高的 1500 个
  python3 scripts/enrich_bangumi_ids.py --limit 500 --only-missing-image
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

import threading

from common import RAW, append_jsonl, bgm_cid, log, norm_space, read_jsonl
from parallel import RateLimiter, parallel_map

API = "https://api.bgm.tv/v0/characters/{id}"
OUT = os.path.join(RAW, "bangumi_images.jsonl")
DUMP = os.path.join(RAW, "bangumi_dump.jsonl")
SLEEP = float(os.environ.get("BANGUMI_SLEEP", "1.05"))


def fetch(cid: str) -> dict | None:
    from common import get_json

    return get_json(API.format(id=cid), timeout=40)  # type: ignore[return-value]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=1200)
    ap.add_argument("--only-missing-image", action="store_true", default=True)
    ap.add_argument("--workers", type=int, default=5, help="并发线程数")
    ap.add_argument("--rps", type=float, default=3.0, help="对该站点的请求速率上限（请求/秒）")
    args = ap.parse_args()

    if not os.path.exists(DUMP):
        log("缺少 raw/bangumi_dump.jsonl，请先跑 fetch_bangumi_dump.py")
        return 1

    rows = [json.loads(line) for line in open(DUMP, encoding="utf-8")]
    done = {bgm_cid(r) for r in read_jsonl(OUT) if bgm_cid(r)}
    todo = [r for r in rows if bgm_cid(r) and bgm_cid(r) not in done]
    todo.sort(key=lambda r: -(r.get("collects") or 0))
    todo = todo[: args.limit]
    log(f"Bangumi 补图：候选 {len(rows)}，已完成 {len(done)}，本次处理 {len(todo)}"
        f"（{args.workers} 线程 / 限速 {args.rps} req/s）")
    if not todo:
        return 0

    lock = threading.Lock()
    limiter = RateLimiter(rps=args.rps)
    stat = {"ok": 0}

    def work(row: dict):
        cid = bgm_cid(row)
        if not cid:
            return None
        try:
            data = fetch(cid)
        except Exception as e:  # noqa: BLE001
            log(f"  ! {cid} 失败：{e}")
            return None
        images = (data or {}).get("images") or {}
        st = (data or {}).get("stat") or {}
        rec = {
            "bgm_id": cid,
            "image": images.get("large") or images.get("medium") or "",
            "image_medium": images.get("medium") or images.get("large") or "",
            "summary": norm_space(((data or {}).get("summary") or "").replace("\r", " ").replace("\n", " "))[:400],
            "collects": st.get("collects") or 0,
            "nsfw": bool((data or {}).get("nsfw")),
        }
        with lock:                      # 边跑边落盘，中断不丢
            append_jsonl(OUT, rec)
            if rec["image"]:
                stat["ok"] += 1
        return rec

    parallel_map(
        todo, work,
        workers=args.workers, limiter=limiter,
        on_progress=lambda d, t, ok: log(f"  进度 {d}/{t}  拿到立绘 {stat['ok']}"),
        progress_every=50,
        label="bgm",
    )
    ok = stat["ok"]
    log(f"完成：{ok}/{len(todo)} 拿到立绘 → {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
