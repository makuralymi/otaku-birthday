"""从 Bangumi 官方全量 dump 导入游戏角色（GalGame / 二次元游戏为主）。

数据源：https://github.com/bangumi/Archive （每周三更新的官方全量导出）
  角色表 character.jsonlines      id / role / name / infobox（含生日、中文名、血型…）
  条目角色关联 subject-characters.jsonlines
  条目表 subject.jsonlines        type 4 = 游戏，含 tags / 平台 / 游戏类型 / 中文名 / 排名

相比逐个请求 API：
  · 一次下载拿到全量（约 22 万角色、68 万条目、11 万游戏条目）
  · 不需要 10 万次 API 请求，对数据源更友好
  · infobox 里直接带简体中文名与生日，无需再做名称匹配

导入策略（本站只缺「游戏」侧数据，动画/漫画由 AniList 覆盖）：
  · 只导入「至少登场于一部游戏条目」且有生日的角色
  · GalGame 与其它游戏按 tags / 游戏类型区分
  · 按角色收藏数（Bangumi 站内热度）设门槛与上限，避免把无人问津的条目灌进来
  · 同名 + 同生日在脚本内先去重，跨源去重交给 build_dataset.py

用法：
  python3 scripts/fetch_bangumi_dump.py                 # 自动下载/解压 + 导入
  python3 scripts/fetch_bangumi_dump.py --min-collects 3 --max 20000
  python3 scripts/fetch_bangumi_dump.py --dry-run       # 只统计不写文件
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from collections import defaultdict

from common import RAW, log, norm_name

DUMP_DIR = os.path.join(RAW, "dump")
ZIP_PATH = os.path.join(DUMP_DIR, "dump.zip")
LATEST_URL = "https://raw.githubusercontent.com/bangumi/Archive/master/aux/latest.json"
OUT = os.path.join(RAW, "bangumi_dump.jsonl")
NEEDED = ("character.jsonlines", "subject-characters.jsonlines", "subject.jsonlines")

# GalGame 判别：标签或「游戏类型」字段命中这些词
GAL_TAG = re.compile(
    r"galgame|gal\b|エロゲ|eroge|18禁|r18|美少女|visual\s*novel|ビジュアルノベル|ノベルゲーム"
    r"|恋爱adv|恋愛adv|avg\b|adventure\s*game|サウンドノベル|乙女",
    re.I,
)
GAL_TYPE = re.compile(r"\b(adv|avg|vn)\b|视觉小说|ビジュアルノベル|恋愛|恋爱|ノベル", re.I)

BIRTH_PATTERNS = [
    re.compile(r"(\d{1,2})\s*月\s*(\d{1,2})\s*日"),        # 12月5日
    re.compile(r"(?<!\d)(\d{1,2})\s*[-/.]\s*(\d{1,2})(?!\d)"),  # 12-05 / 12/5 / ????-05-09
]
BOX_FIELDS = {
    "name_cn": re.compile(r"\|\s*(?:简体中文名|中文名)\s*=\s*([^\r\n|}]*)"),
    "name_ja": re.compile(r"\|\s*日文名\s*=\s*([^\r\n|}]*)"),
    "romaji": re.compile(r"\|\s*(?:罗马字|羅馬字|英文名)\s*=\s*([^\r\n|}]*)"),
    "gender": re.compile(r"\|\s*性别\s*=\s*([^\r\n|}]*)"),
    "blood": re.compile(r"\|\s*血型\s*=\s*([^\r\n|}]*)"),
    "height": re.compile(r"\|\s*身高\s*=\s*([^\r\n|}]*)"),
    "birth": re.compile(r"\|\s*生日\s*=\s*([^\r\n|}]*)"),
    "alias_block": re.compile(r"\|\s*别名\s*=\s*\{(.*?)\}", re.S),
}
SUBJECT_TYPE = {1: "漫画", 2: "动画", 3: "音乐", 4: "游戏", 6: "其他"}
GAME = 4


# ─────────────────────────── dump 获取 ───────────────────────────


def ensure_dump() -> str:
    """确保 dump 已下载并解压出需要的三张表，返回解压目录。"""
    os.makedirs(DUMP_DIR, exist_ok=True)
    missing = [n for n in NEEDED if not os.path.exists(os.path.join(DUMP_DIR, n))]
    if not missing:
        return DUMP_DIR

    if not os.path.exists(ZIP_PATH):
        log("下载 Bangumi 官方 dump（约 430 MB，每周更新）…")
        meta = json.loads(_http_get(LATEST_URL))
        url, size, digest = meta["browser_download_url"], meta["size"], meta.get("digest", "")
        log(f"  {meta['name']}  {size/1e6:.1f} MB")
        # 断点续传 + 停滞重连；git/curl 都可能被 CDN 掐断
        for attempt in range(1, 6):
            have = os.path.getsize(ZIP_PATH) if os.path.exists(ZIP_PATH) else 0
            log(f"  第 {attempt} 次尝试（已有 {have/1e6:.1f} MB）")
            subprocess.run(
                ["curl", "-sSL", "-C", "-", "--speed-limit", "30000", "--speed-time", "25",
                 "-o", ZIP_PATH, url],
                check=False,
            )
            if os.path.exists(ZIP_PATH) and os.path.getsize(ZIP_PATH) == size:
                break
            time.sleep(3)
        if not os.path.exists(ZIP_PATH) or os.path.getsize(ZIP_PATH) != size:
            raise RuntimeError("dump 下载失败，请手动下载后放到 raw/dump/dump.zip")
        if digest.startswith("sha256:"):
            import hashlib

            h = hashlib.sha256()
            with open(ZIP_PATH, "rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            if h.hexdigest() != digest.split(":", 1)[1]:
                raise RuntimeError("dump 校验失败")

    log(f"解压 {', '.join(missing)} …")
    subprocess.run(["7z", "x", "-y", f"-o{DUMP_DIR}", ZIP_PATH, *missing], check=True,
                   stdout=subprocess.DEVNULL)
    return DUMP_DIR


def _http_get(url: str) -> bytes:
    import urllib.request

    req = urllib.request.Request(url, headers={"User-Agent": "otaku-birthday/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


# ─────────────────────────── 解析 ───────────────────────────


def parse_birth(text: str) -> tuple[int, int] | None:
    text = (text or "").strip()
    if not text or "不明" in text or "不详" in text or "未定" in text:
        return None
    for pat in BIRTH_PATTERNS:
        m = pat.search(text)
        if not m:
            continue
        mo, d = int(m.group(1)), int(m.group(2))
        # 兼容 05-09 这类「年-月-日」里被截到的月日（月>12 时交换）
        if mo > 12 and d <= 12:
            mo, d = d, mo
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return mo, d
    return None


def parse_box(box: str) -> dict:
    out: dict = {}
    for key, pat in BOX_FIELDS.items():
        m = pat.search(box or "")
        out[key] = (m.group(1).strip() if m else "")
    # 别名块形如：{ [L.L.] [英文名|Lelouch Lamperouge] [第二中文名|鲁鲁修] }
    # 注意：值为空时（[英文名|]）**不能**把字段名当别名，否则几万个角色会共享同一个 key
    labels = {"英文名", "英文名二", "日文名", "纯假名", "罗马字", "昵称", "其他名义", "其它名义",
              "第二中文名", "第三中文名", "韩文名", "繁体名", "别名", "本名", "CV"}
    plain: list[str] = []
    labeled: dict[str, list[str]] = {}
    am = BOX_FIELDS["alias_block"].search(box or "")
    if am:
        for item in re.findall(r"\[([^\[\]]+)\]", am.group(1)):
            if "|" in item:
                label, value = item.split("|", 1)
                label, value = label.strip(), value.strip()
                if value:
                    labeled.setdefault(label, []).append(value)
            else:
                text = item.strip()
                if text and text not in labels:
                    plain.append(text)
    # 英文名 / 罗马字 → 供跨源匹配；日文名 → 日文原名；其余中文别名 → 展示用别名
    romaji = next((v[0] for k, v in labeled.items() if k in ("罗马字", "英文名", "英文名二") and v), "")
    name_ja = next((v[0] for k, v in labeled.items() if k == "日文名" and v), "")
    alias_pool = list(dict.fromkeys(
        plain
        + [v for k, vs in labeled.items() if k in ("第二中文名", "第三中文名", "昵称") for v in vs]
    ))
    out["aliases"] = [a for a in alias_pool if a != out.get("name_cn")][:8]
    if romaji and not out.get("romaji"):
        out["romaji"] = romaji
    out["name_ja"] = name_ja
    return out


def clean_text(s: str | None, limit: int = 300) -> str:
    t = re.sub(r"\s+", " ", (s or "").replace("\r", " ").replace("\n", " ")).strip()
    return t[:limit]


def norm_gender(raw: str) -> str:
    t = (raw or "").strip()
    if t.startswith("男"):
        return "男"
    if t.startswith("女"):
        return "女"
    return "" if not t else "其他"


# ─────────────────────────── 主流程 ───────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-collects", type=int, default=1, help="角色收藏数下限（Bangumi 站内热度）")
    ap.add_argument("--min-collects-anime", type=int, default=2, help="纯动画/漫画角色收藏数下限")
    ap.add_argument("--include-anime", action="store_true", default=True, help="包含动画/漫画角色")
    ap.add_argument("--max", type=int, default=30000, help="最多导入多少个角色（按收藏数降序）")
    ap.add_argument("--gal-game-rank", type=int, default=20000,
                    help="即使收藏数不够，也保留「排名进入前 N 的游戏」里的角色")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    dump = ensure_dump()
    t0 = time.time()

    # ① 角色：只留 role=1（角色，排除机体/组织）且有生日的
    chars: dict[int, dict] = {}
    scanned = 0
    for line in open(os.path.join(dump, "character.jsonlines"), encoding="utf-8"):
        scanned += 1
        if scanned % 50000 == 0:
            log(f"  扫描角色 {scanned} …")
        if '"infobox":null' in line or '"infobox": null' in line:
            continue
        try:
            c = json.loads(line)
        except json.JSONDecodeError:
            continue
        if c.get("role") != 1:
            continue
        box = parse_box(c.get("infobox") or "")
        bd = parse_birth(box.get("birth", ""))
        if not bd:
            continue
        chars[c["id"]] = {
            "id": c["id"],
            "name": (c.get("name") or "").strip(),
            "name_cn": box.get("name_cn", ""),
            "romaji": box.get("romaji", ""),
            "aliases": box.get("aliases", []),
            "gender": norm_gender(box.get("gender", "")),
            "blood": (box.get("blood") or "").replace("型", "").strip().upper()[:4],
            "month": bd[0],
            "day": bd[1],
            "summary": clean_text(c.get("summary")),
            "collects": int(c.get("collects") or 0),
            "comments": int(c.get("comments") or 0),
            "subjects": [],
        }
    log(f"① 有生日的角色 {len(chars)} 个（扫描 {scanned} 行，用时 {time.time()-t0:.0f}s）")

    # ② 角色 → 条目关联
    rel = 0
    for line in open(os.path.join(dump, "subject-characters.jsonlines"), encoding="utf-8"):
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        cid = r.get("character_id")
        if cid in chars:
            chars[cid]["subjects"].append((r.get("subject_id"), r.get("type") or 2))
            rel += 1
    log(f"② 角色-条目关联 {rel} 条")

    # ③ 条目信息（只取被引用到的）
    wanted = {sid for c in chars.values() for sid, _ in c["subjects"]}
    log(f"③ 需要解析的条目 {len(wanted)} 个")
    subjects: dict[int, dict] = {}
    for line in open(os.path.join(dump, "subject.jsonlines"), encoding="utf-8"):
        if '"id":' not in line:
            continue
        try:
            s = json.loads(line)
        except json.JSONDecodeError:
            continue
        sid = s.get("id")
        if sid not in wanted:
            continue
        tags = [t.get("name", "") for t in (s.get("tags") or []) if t.get("name")]
        box = s.get("infobox") or ""
        m = re.search(r"\|\s*游戏类型\s*=\s*([^\r\n|}]*)", box)
        gtype = (m.group(1).strip() if m else "")
        is_game = s.get("type") == GAME
        is_gal = bool(is_game and (GAL_TAG.search(" ".join(tags[:12]) + " " + gtype) or GAL_TYPE.search(gtype)))
        year = 0
        dm = re.search(r"(\d{4})", str(s.get("date") or ""))
        if dm:
            year = int(dm.group(1))
        subjects[sid] = {
            "id": sid,
            "type": s.get("type"),
            "name": s.get("name") or "",
            "name_cn": s.get("name_cn") or "",
            "year": year,
            "rank": s.get("rank") or 0,
            "score": s.get("score") or 0,
            "nsfw": bool(s.get("nsfw")),
            "is_game": is_game,
            "is_gal": is_gal,
            "staff": 0,
        }

    # ④ 筛选：保留游戏角色（GalGame/一般游戏），以及热度达标的动画/漫画角色
    picked: list[dict] = []
    for c in chars.values():
        subjs = [subjects[sid] for sid, _ in c["subjects"] if sid in subjects]
        if not subjs:
            continue
        games = [s for s in subjs if s["is_game"]]
        has_anime = any(s["type"] == 2 for s in subjs)
        has_manga = any(s["type"] == 1 for s in subjs)
        
        best_rank = 999999
        qualifies = False
        if games:
            games.sort(key=lambda g: (g["rank"] or 999999))
            best_rank = games[0]["rank"] or 999999
            qualifies = c["collects"] >= args.min_collects or best_rank <= args.gal_game_rank
        elif args.include_anime and (has_anime or has_manga):
            anime_subjs = [s for s in subjs if s["type"] in (1, 2)]
            anime_subjs.sort(key=lambda a: (a["rank"] or 999999))
            best_rank = anime_subjs[0]["rank"] or 999999
            qualifies = c["collects"] >= args.min_collects_anime or best_rank <= args.gal_game_rank
            
        if not qualifies:
            continue
        c["games"] = games
        c["best_rank"] = best_rank
        picked.append(c)

    picked.sort(key=lambda c: (-c["collects"], c["best_rank"]))
    if args.max and len(picked) > args.max:
        picked = picked[: args.max]
    log(f"④ 命中「登场条目 + 热度达标」的角色 {len(picked)} 个"
        f"（GalGame 作品 {sum(1 for c in picked for g in c['games'] if g['is_gal'])} 次）")

    # ⑤ 脚本内去重：同名 + 同生日只留数据最全的一个
    seen: dict[tuple, dict] = {}
    deduped: list[dict] = []
    for c in picked:
        # 只用确定字段做 key（别名里「爱丽丝」「レイ」这类重名太多，会把不同角色误合并）
        keys = {norm_name(c["name"]), norm_name(c["name_cn"]), norm_name(c.get("name_ja") or "")}
        keys = {k for k in keys if len(k) >= 2}
        keys.discard("")
        hit = None
        for k in keys:
            hit = seen.get((k, c["month"], c["day"]))
            if hit:
                break
        if hit:
            # 合并：保留收藏数高 / 作品多的那个，把另一边的别名与作品并进来
            keep, drop = (hit, c) if (hit["collects"], len(hit["subjects"])) >= (c["collects"], len(c["subjects"])) else (c, hit)
            keep["aliases"] = list(dict.fromkeys(keep["aliases"] + drop["aliases"]))[:8]
            keep["subjects"] = list(dict.fromkeys(keep["subjects"] + drop["subjects"]))
            keep["games"] = list({g["id"]: g for g in keep["games"] + drop["games"]}.values())
            keep["collects"] = max(keep["collects"], drop["collects"])
            for f in ("name_cn", "romaji", "name_ja", "summary"):
                if not keep.get(f):
                    keep[f] = drop.get(f, "")
            keep["blood"] = keep.get("blood") or drop.get("blood", "")
            keep["gender"] = keep.get("gender") or drop.get("gender", "")
            if drop is c:
                continue
            deduped = [keep if d is hit else d for d in deduped]
            continue
        for k in keys:
            seen[(k, c["month"], c["day"])] = c
        deduped.append(c)

    log(f"⑤ 脚本内去重后 {len(deduped)} 个（合并掉 {len(picked) - len(deduped)} 个重名同生日）")

    # ⑥ 输出
    rows = []
    for c in deduped:
        works = []
        for sub in sorted(c["subjects"], key=lambda x: -(subjects.get(x[0], {}).get("score") or 0)):
            s = subjects.get(sub[0])
            if not s:
                continue
            works.append({
                "id": s["id"],
                "title": s["name"],
                "title_cn": s["name_cn"],
                "type": SUBJECT_TYPE.get(s["type"], "其他"),
                "is_gal": s["is_gal"],
                "year": s["year"] or None,
                "rank": s["rank"],
                "staff": {1: "主角", 2: "配角", 3: "客串"}.get(sub[1], ""),
                "nsfw": s["nsfw"],
            })
        # 作品类型：GalGame 优先，其次游戏，再是其它改编
        types = []
        if any(w["is_gal"] for w in works):
            types.append("Galgame")
        if any(w["type"] == "游戏" for w in works):
            types.append("游戏")
        for t in ("动画", "漫画", "轻小说"):
            if any(w["type"] == t for w in works):
                types.append(t)
        primary = types[0] if types else "游戏"
        rows.append({
            "source": "bangumi",
            "source_id": f"bgm{c['id']}",
            "bgm_id": str(c["id"]),
            "name_native": c.get("name_ja") or c["name"],
            "name_cn": c["name_cn"],
            "name_romaji": c["romaji"],
            "alt_names": c["aliases"],
            "month": c["month"],
            "day": c["day"],
            "year": None,
            "gender": c["gender"],
            "blood_type": c["blood"],
            "favourites": c["collects"],
            "collects": c["collects"],
            "summary": c["summary"],
            "image": "",
            "image_medium": "",
            "url": f"https://bgm.tv/character/{c['id']}",
            "works": works[:6],
            "types": types or ["游戏"],
            "ptype": primary,
            "raw_type": primary,
            "nsfw": bool(works and all(w["nsfw"] for w in works)),
        })

    if args.dry_run:
        log(f"[dry-run] 将写入 {len(rows)} 条，样例：")
        for r in rows[:3]:
            log(f"   {r['name_cn'] or r['name_native']} {r['month']}/{r['day']} "
                f"types={r['types']} works={[w['title_cn'] or w['title'] for w in r['works'][:2]]}")
        return 0

    with open(OUT, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    log(f"⑥ 写入 {len(rows)} 条 → {OUT}")
    log(f"   分类统计：Galgame {sum(1 for r in rows if 'Galgame' in r['types'])}，"
        f"纯游戏 {sum(1 for r in rows if r['ptype'] == '游戏')}，"
        f"含中文名 {sum(1 for r in rows if r['name_cn'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
