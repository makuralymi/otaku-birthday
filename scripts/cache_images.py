"""把最热门角色的立绘缓存到本地（可选的「最后一条线路」）。

默认不缓存——站点平时直接引用原站 CDN。跑这个脚本后：
  assets/img/cache/<id>.<ext>   本地图片文件
  data/local_images.json        清单（前端会优先读本地文件，离线/CDN 全挂也能看图）

用法：
  python3 scripts/cache_images.py --limit 200      # 按人气缓存前 200 个角色
  python3 scripts/cache_images.py --limit 0        # 清空缓存清单（不删文件）
  python3 scripts/cache_images.py --all            # 全量（体积很大，谨慎）

抓取顺序同样是多线路：直连 → 同内容镜像 → 第三方代理。
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
CACHE_DIR = os.path.join(ROOT, "public", "img", "cache")
MANIFEST = os.path.join(DATA, "local_images.json")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_dataset import _proxies  # noqa: E402  复用同一套兜底线路定义

UA = "otaku-birthday/1.0 (image cache for personal fan project)"
EXT = {".jpg": ".jpg", ".jpeg": ".jpg", ".png": ".png", ".webp": ".webp", ".gif": ".gif"}


def candidates(url: str) -> list[str]:
    out = [url]
    try:
        parts = urlsplit(url)
        if parts.hostname == "t.vndb.org":
            out.append(url.replace("//t.vndb.org/", "//s.vndb.org/"))
        elif parts.hostname == "s.vndb.org":
            out.append(url.replace("//s.vndb.org/", "//t.vndb.org/"))
    except ValueError:
        pass
    out.extend(_proxies(url, 300))
    return out


def download(url: str) -> tuple[bytes, str] | None:
    for candidate in candidates(url):
        try:
            req = urllib.request.Request(candidate, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            if len(data) < 512:
                continue
            ext = os.path.splitext(urlsplit(candidate).path)[1].lower()
            return data, EXT.get(ext, ".jpg")
        except Exception:  # noqa: BLE001
            continue
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=200, help="按人气缓存前 N 个角色（0 = 只清空清单）")
    ap.add_argument("--all", action="store_true", help="缓存全部角色（体积很大）")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(os.path.join(DATA, "characters.csv"), encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    rows.sort(key=lambda r: -int(r["heat"] or 0))
    targets = rows if args.all else rows[: args.limit]

    manifest: dict = {"generated_at": "", "count": 0, "images": {}}
    if os.path.exists(MANIFEST):
        try:
            with open(MANIFEST, encoding="utf-8") as fh:
                manifest.update(json.load(fh))
        except json.JSONDecodeError:
            pass
    images = manifest.get("images", {})

    if not targets:
        manifest["images"] = {}
        manifest["count"] = 0
        with open(MANIFEST, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=1)
        print("已清空本地图片清单（文件保留在 assets/img/cache/）")
        return 0

    lock = threading.Lock()
    done = 0

    def work(row: dict) -> None:
        nonlocal done
        cid = row["id"]
        url = row.get("thumb") or row.get("image")
        if not url:
            return
        got = download(url)
        if not got:
            with lock:
                done += 1
                print(f"  ! {cid} 三条线路都失败")
            return
        data, ext = got
        name = f"{cid}{ext}"
        with open(os.path.join(CACHE_DIR, name), "wb") as fh:
            fh.write(data)
        with lock:
            images[cid] = {"thumb": f"img/cache/{name}", "image": f"img/cache/{name}"}
            done += 1
            if done % 25 == 0:
                print(f"  已缓存 {done}/{len(targets)}")

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(work, targets))

    import time

    manifest["images"] = images
    manifest["count"] = len(images)
    manifest["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    total = sum(os.path.getsize(os.path.join(CACHE_DIR, f)) for f in os.listdir(CACHE_DIR)) / 1024 / 1024
    print(f"完成：清单 {len(images)} 个角色，本地缓存 {total:.1f} MB → {CACHE_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
