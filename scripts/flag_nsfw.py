"""给 VNDB 角色打 R18 标记（图源是否含露骨内容）。

VNDB 的图片对象带有 sexual / violence 标记，但只有单独查询才会返回，
所以这里按 id 批量补一次（每批 100 个 id，几十次请求即可），
结果写入 raw/vndb_nsfw.json（{角色id: true}），build_dataset.py 会自动读取。

用法：python3 scripts/flag_nsfw.py
"""

from __future__ import annotations

import json
import os
import sys
import time

from common import RAW, log, post_json, read_jsonl

API = "https://api.vndb.org/kana/character"
SRC = os.path.join(RAW, "vndb.jsonl")
OUT = os.path.join(RAW, "vndb_nsfw.json")
BATCH = 100  # 每页返回 100 条
SLEEP = float(os.environ.get("VNDB_SLEEP", "1.5"))


def main() -> int:
    if not os.path.exists(SRC):
        log("没有 raw/vndb.jsonl，先跑 fetch_vndb.py")
        return 1
    records = read_jsonl(SRC)
    ids = [r["source_id"] for r in records]
    flags: dict[str, bool] = {}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as fh:
            flags = json.load(fh)
    todo = [i for i in ids if i not in flags]
    log(f"VNDB R18 标记：共 {len(ids)} 个角色，待处理 {len(todo)}")
    # VNDB 不支持 `["id","in",[...]]`，所以按 id 排序翻页取回（每页 100 条，字段极小）
    page = 1
    while True:
        try:
            data = post_json(
                API,
                {
                    "filters": ["birthday", "!=", None],
                    "fields": "id,image.sexual,image.violence",
                    "sort": "id",
                    "results": BATCH,
                    "page": page,
                },
                timeout=60,
            ) or {}
        except Exception as e:  # noqa: BLE001
            log(f"  ! 第 {page} 页失败：{e}")
            time.sleep(5)
            page += 1
            if page > 400:
                break
            continue
        results = data.get("results") or []
        if not results:
            break
        for item in results:
            img = item.get("image") or {}
            flags[str(item.get("id"))] = bool(img.get("sexual") or img.get("violence"))
        if page % 20 == 0:
            log(f"  进度 page={page}  已标记 {len(flags)}  已处理 {sum(1 for i in ids if i in flags)}/{len(ids)}")
            with open(OUT, "w", encoding="utf-8") as fh:
                json.dump(flags, fh)
        if not data.get("more"):
            break
        time.sleep(SLEEP)
        page += 1
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(flags, fh)
    nsfw = sum(1 for v in flags.values() if v)
    log(f"完成：{len(flags)} 个角色，其中 {nsfw} 个标记为 R18 → {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
