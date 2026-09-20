#!/usr/bin/env python3
"""清洗与增补二次元游戏角色数据（《鸣潮》、《崩坏3》、《星穹铁道》等）。

功能：
1. 《鸣潮》：
   - 规范化 23 位共鸣者数据，补齐缺失的 name_cn；
   - 纠正「炽霞」（原误填为彩蛋真名「马小芳」），将「马小芳」置入 alt_names；
   - 纠正「坎特蕾拉」（原为长译名「坎特蕾拉·翡萨烈」）；
   - 为「渊武」添加「元武」别名；
   - 为全员注入「鸣朝」「Wuthering Waves」「WW」错别字与常见别名；
   - 增补社区挖掘参考的共鸣者「椿 (Camellya)」（12月10日）；
2. 《崩坏3》：
   - 将琪亚娜、雷电芽衣、布洛妮娅、符华、姬子、爱莉希雅、德丽莎、希儿、八重樱的
     作品名和别名注入「崩坏3」「Honkai Impact 3rd」「崩三」「崩坏三」，补全 name_cn；
3. 《星穹铁道》：
   - 补全三月七的 name_cn，注入「星铁」「崩铁」「Star Rail」别名；
4. 同步覆写 public/data/search-index.csv、public/data/days/*.csv 与 public/data/meta.json。
"""

from __future__ import annotations

import csv
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
SEARCH_INDEX = os.path.join(DATA, "search-index.csv")
DAYS_DIR = os.path.join(DATA, "days")
META_PATH = os.path.join(DATA, "meta.json")

INDEX_COLUMNS = [
    "id", "src", "month", "day", "name_cn", "name_native", "name_romaji", "alt_names",
    "types", "ptype", "work", "work_cn", "work_year", "heat", "fav", "votes", "collects",
    "nsfw", "thumb", "image", "alts", "palette", "bgm_id", "url_al", "url_bgm", "url_vndb",
]

DAY_COLUMNS = [
    "id", "src", "month", "day", "year",
    "name_cn", "name_native", "name_romaji", "alt_names",
    "gender", "blood", "age", "types", "ptype",
    "work", "work_cn", "work_year", "work_fmt", "works",
    "summary", "heat", "fav", "votes", "collects", "nsfw",
    "image", "thumb", "alts", "palette", "tags",
    "url_al", "url_bgm", "url_vndb", "bgm_id",
]

# 新增角色：椿 (Camellya)
CAMELLYA_RECORD = {
    "id": "bgm-bgm164113",
    "src": "bangumi",
    "month": "12",
    "day": "10",
    "year": "",
    "name_cn": "椿",
    "name_native": "椿",
    "name_romaji": "Camellya",
    "alt_names": "Camellya / ツバキ / 鸣朝 / Wuthering Waves / WW",
    "gender": "女",
    "blood": "",
    "age": "",
    "types": "游戏",
    "ptype": "游戏",
    "work": "鸣潮",
    "work_cn": "鸣潮",
    "work_year": "2024",
    "work_fmt": "Game",
    "works": '[{"t":"鸣潮","cn":"鸣潮","ty":"游戏","y":2024,"pop":0}]',
    "summary": "“我很期待……这场只属于你我的游戏。”——椿。黑海岸执花椿，自由随性，自有一种“危险”的吸引力。她相信这个世界中存在着命运既定的牵系，且乐意顺着这份牵引愉快地游走世间。",
    "heat": "99",
    "fav": "20",
    "votes": "0",
    "collects": "99",
    "nsfw": "",
    "image": "https://lain.bgm.tv/pic/crt/l/14/51/164113_crt_5Ph65.jpg?r=1726205669",
    "thumb": "https://lain.bgm.tv/r/400/pic/crt/l/14/51/164113_crt_5Ph65.jpg?r=1726205669",
    "alts": "",
    "palette": "#c4334a",
    "tags": "黑海岸 执花 湮灭 鸣潮 鸣朝",
    "url_al": "",
    "url_bgm": "https://bgm.tv/character/164113",
    "url_vndb": "",
    "bgm_id": "164113",
}

# 崩坏3 知名角色列表及其官方中文名与别名
HONKAI_3_MAP = {
    "al142947": {"name_cn": "琪亚娜·卡斯兰娜", "name_native": "琪亚娜·卡斯兰娜"},
    "al142946": {"name_cn": "雷电芽衣", "name_native": "雷电芽衣"},
    "al142948": {"name_cn": "布洛妮娅·扎伊切克", "name_native": "布洛妮娅·扎伊切克"},
    "al142949": {"name_cn": "符华", "name_native": "符华"},
    "al142944": {"name_cn": "无量塔姬子", "name_native": "无量塔姬子"},
    "al284954": {"name_cn": "爱莉希雅", "name_native": "爱莉希雅"},
    "bgm-bgm45100": {"name_cn": "德丽莎·阿波卡利斯", "name_native": "德丽莎·阿波卡利斯"},
    "al142952": {"name_cn": "希儿·芙乐艾", "name_native": "希儿·芙乐艾"},
    "bgm-bgm46073": {"name_cn": "八重樱", "name_native": "八重樱"},
}


def add_alt(cur_alt: str, *additions: str) -> str:
    tokens = [t.strip() for t in cur_alt.split("/") if t.strip()] if cur_alt else []
    for a in additions:
        if a and a not in tokens:
            tokens.append(a)
    return " / ".join(tokens)


def process_row(row: dict) -> dict:
    cid = row.get("id", "")
    w = row.get("work", "")
    w_cn = row.get("work_cn", "")

    # 1. 鸣潮角色清洗
    if w == "鸣潮" or w_cn == "鸣潮":
        row["work"] = "鸣潮"
        row["work_cn"] = "鸣潮"
        # 补全中文名
        if not row.get("name_cn"):
            row["name_cn"] = row.get("name_native", "")

        # 纠正炽霞（原误为马小芳）
        if cid == "bgm-bgm158095" or row.get("name_native") == "炽霞" or row.get("name_cn") == "马小芳":
            row["name_cn"] = "炽霞"
            row["name_native"] = "炽霞"
            row["alt_names"] = add_alt(row.get("alt_names", ""), "马小芳", "Chixia")

        # 纠正坎特蕾拉
        if cid == "bgm-bgm171681" or "坎特蕾拉" in row.get("name_cn", ""):
            row["name_cn"] = "坎特蕾拉"
            row["name_native"] = "坎特蕾拉"
            row["alt_names"] = add_alt(row.get("alt_names", ""), "坎特蕾拉·翡萨烈", "Cantarella")

        # 渊武添加元武别名
        if cid == "bgm-bgm158089" or "渊武" in row.get("name_native", ""):
            row["alt_names"] = add_alt(row.get("alt_names", ""), "元武", "Yuanwu")

        # 鸣潮全员注入「鸣朝」错别字容错与英文缩写
        row["alt_names"] = add_alt(row.get("alt_names", ""), "鸣朝", "Wuthering Waves", "WW")

    # 2. 崩坏3 角色修正
    if cid in HONKAI_3_MAP:
        meta = HONKAI_3_MAP[cid]
        row["name_cn"] = meta["name_cn"]
        row["name_native"] = meta["name_native"]
        # 作品名中加入 崩坏3
        if "崩坏3" not in (row.get("work_cn") or ""):
            row["work_cn"] = "崩坏3"
        row["alt_names"] = add_alt(row.get("alt_names", ""), "崩坏3", "崩坏三", "崩3", "Honkai Impact 3rd")

    # 3. 星穹铁道角色修正
    if cid == "bgm-bgm109857" or row.get("name_native") == "三月七":
        row["name_cn"] = "三月七"
        row["alt_names"] = add_alt(row.get("alt_names", ""), "星铁", "崩铁", "Star Rail", "崩坏：星穹铁道")

    return row


def main() -> None:
    print("正在清洗与增补二次元游戏角色数据…")

    # ① 处理 search-index.csv
    with open(SEARCH_INDEX, "r", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        index_rows = [process_row(r) for r in reader]

    # 检查是否已包含椿
    has_camellya = any(r["id"] == CAMELLYA_RECORD["id"] for r in index_rows)
    if not has_camellya:
        cam_index = {k: CAMELLYA_RECORD.get(k, "") for k in INDEX_COLUMNS}
        index_rows.append(cam_index)
        print("  ✓ 已向索引中增补共鸣者：椿 (12月10日)")

    # 重新排序
    index_rows.sort(key=lambda r: (-int(r.get("heat") or 0), int(r["month"]), int(r["day"])))

    with open(SEARCH_INDEX, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=INDEX_COLUMNS)
        writer.writeheader()
        writer.writerows(index_rows)
    print(f"  ✓ 已更新 {SEARCH_INDEX}（共 {len(index_rows)} 行）")

    # ② 处理 days/*.csv
    updated_days = 0
    updated_by_id = {r["id"]: r for r in index_rows}

    for fname in os.listdir(DAYS_DIR):
        if not fname.endswith(".csv"):
            continue
        path = os.path.join(DAYS_DIR, fname)
        m = int(fname[:2])
        d = int(fname[2:4])

        with open(path, "r", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            fieldnames = reader.fieldnames or DAY_COLUMNS
            rows = list(reader)

        modified = False
        new_rows = []
        for r in rows:
            cid = r.get("id")
            if cid in updated_by_id:
                up = updated_by_id[cid]
                for fld in ("name_cn", "name_native", "alt_names", "work", "work_cn"):
                    if r.get(fld) != up.get(fld):
                        r[fld] = up[fld]
                        modified = True
            new_rows.append(r)

        # 检查 1210.csv 是否需要加入椿
        if m == 12 and d == 10 and not any(r["id"] == CAMELLYA_RECORD["id"] for r in new_rows):
            new_rows.append(CAMELLYA_RECORD)
            modified = True
            print("  ✓ 已向 1210.csv 加入共鸣者：椿")

        if modified:
            new_rows.sort(key=lambda r: -int(r.get("heat") or 0))
            with open(path, "w", encoding="utf-8", newline="") as fh:
                writer = csv.DictWriter(fh, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(new_rows)
            updated_days += 1

    print(f"  ✓ 已更新 {updated_days} 个按天分片 CSV 文件")

    # ③ 更新 meta.json
    if os.path.exists(META_PATH):
        with open(META_PATH, "r", encoding="utf-8") as fh:
            meta = json.load(fh)

        meta["total"] = len(index_rows)
        meta["days"][11][10] = sum(1 for r in index_rows if r["month"] == "12" and r["day"] == "10")
        flat = []
        for m in range(12):
            flat.extend(meta["days"][m][1:])
        meta["days_flat"] = flat
        meta["months"][11] = sum(meta["days"][11][1:])
        if "游戏" in meta.get("types", {}):
            meta["types"]["游戏"] = sum(1 for r in index_rows if "游戏" in r.get("types", ""))

        with open(META_PATH, "w", encoding="utf-8") as fh:
            json.dump(meta, fh, ensure_ascii=False, indent=2)
        print("  ✓ 已更新 meta.json 元数据统计")


if __name__ == "__main__":
    main()
