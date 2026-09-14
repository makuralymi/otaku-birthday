"""从 B 站 wiki（bwiki）拉取二次元游戏角色条目、信息与立绘。

bwiki 是国内主流二游的官方合作 wiki（原神 / 崩坏3 / 星穹铁道 / 明日方舟 /
蔚蓝档案 / 碧蓝航线 / 绝区零 / 鸣潮 / 公主连结 …），人物页的 infobox 里
通常同时有「生日」「声优」「立绘」，正好补齐我们缺的两样：**条目**与**图片**。

流程（全部并发 + 每站点限速）：
  ① 列出各 wiki 的角色分类成员（1 请求 500 个标题）
  ② 逐个抓人物页首段 HTML（action=parse&prop=text&section=0）
     · 提取生日（多种写法：|生日=、生日：3月17日、Birthday 等）
     · 提取立绘（patchwiki.biligame.com 的图片，优先文件名/alt 含角色名的）
  ③ 输出 raw/bwiki.jsonl（与其它抓取脚本同构），交给 build_dataset.py 去重合并

用法：
  python3 scripts/fetch_bwiki.py --limit-per-wiki 300 --workers 6 --rps 3
  python3 scripts/fetch_bwiki.py --dry-run --limit-per-wiki 20      # 先看命中情况
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from urllib.parse import quote, unquote

from common import RAW, log, norm_name, request
from parallel import RateLimiter, parallel_map

OUT = os.path.join(RAW, "bwiki.jsonl")
UA = "otaku-birthday/1.0 (+https://github.com/makuralymi/otaku-birthday; makuraly@outlook.com)"
API = "https://wiki.biligame.com/{wiki}/api.php"

# 子域名 → 作品名（types 统一按「游戏」，后续与 Bangumi/VNDB 合并时会自动补全类型）
WIKIS = {
    "ys": {"title": "原神", "cats": ["分类:角色", "分类:人物"]},
    "bh3": {"title": "崩坏3", "cats": ["分类:角色", "分类:女武神"]},
    "sr": {"title": "崩坏：星穹铁道", "cats": ["分类:角色", "分类:角色图鉴"]},
    "ak": {"title": "明日方舟", "cats": ["分类:干员", "分类:角色"]},
    "ba": {"title": "蔚蓝档案", "cats": ["分类:角色", "分类:学生"]},
    "blhx": {"title": "碧蓝航线", "cats": ["分类:舰娘", "分类:角色"]},
    "zzz": {"title": "绝区零", "cats": ["分类:角色", "分类:代理人"]},
    "mc": {"title": "鸣潮", "cats": ["分类:角色", "分类:共鸣者"]},
    "pcr": {"title": "公主连结 Re:Dive", "cats": ["分类:角色"]},
}

BIRTH_PATTERNS = [
    re.compile(r"生日[^0-9]{0,12}(\d{1,2})\s*月\s*(\d{1,2})\s*日"),
    re.compile(r"(\d{1,2})\s*月\s*(\d{1,2})\s*日[^0-9]{0,6}(?:生日|诞辰)"),
    re.compile(r"[Bb]irthday[^0-9]{0,20}(\d{1,2})[.\-/月](\d{1,2})"),
    re.compile(r"\|\s*(?:生日|出生日期|生日日期)\s*=\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})"),
]
IMG_TAG_RE = re.compile(r'<img[^>]+>', re.I)
SRC_RE = re.compile(r'src="(https://patchwiki\.biligame\.com/[^"]+\.(?:png|jpg|jpeg|webp))"', re.I)
ALT_RE = re.compile(r'alt="([^"]*)"', re.I)
BAD_IMG = re.compile(r"(icon|logo|avatar|bg|背景|图标|标志|技能|item|道具|素材|npc)", re.I)


def api_get(wiki: str, params: dict) -> dict:
    from urllib.parse import urlencode

    url = f"{API.format(wiki=wiki)}?{urlencode(params)}"
    body = request(url, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=45)
    return json.loads(body)


def parse_birth(text: str) -> tuple[int, int] | None:
    for pat in BIRTH_PATTERNS:
        m = pat.search(text or "")
        if not m:
            continue
        mo, d = int(m.group(1)), int(m.group(2))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return mo, d
    return None


def to_thumb(url: str, width: int = 400, alt: str = "") -> str:
    """bwiki 原图可达数 MB，换成 MediaWiki 缩略图：
    /images/<wiki>/thumb/<a>/<b>/<hash>.<ext>/<width>px-<原始文件名>
    （原始文件名要从 <img alt="..."> 拿，URL 里只有 hash）"""
    m = re.match(r"(https://patchwiki\.biligame\.com)/images/([^/]+)/([^/]+)/([^/]+)/([^/]+)$", url)
    if not m or not alt:
        return url
    host, w1, w2, w3, name = m.groups()
    return f"{host}/images/{w1}/thumb/{w2}/{w3}/{name}/{width}px-{quote(alt)}"


def strip_html(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or ""))


def list_members(wiki: str, cats: list[str], limit: int, limiter: RateLimiter) -> list[str]:
    """列出角色分类下的页面标题（一次请求最多 500 条）"""
    titles: list[str] = []
    for cat in cats:
        limiter.acquire()
        try:
            data = api_get(wiki, {
                "action": "query", "format": "json", "formatversion": "2",
                "list": "categorymembers", "cmtitle": cat, "cmlimit": "500", "cmnamespace": "0",
            })
        except Exception:  # noqa: BLE001
            continue
        members = ((data.get("query", {}) or {}).get("categorymembers")) or []
        titles += [m["title"] for m in members if m.get("title")]
        if len(titles) >= limit:
            break
        time.sleep(0.3)
    # 过滤掉明显不是角色的页面
    out = [t for t in dict.fromkeys(titles) if 1 <= len(t) <= 20 and not re.search(r"(皮肤|时装|图鉴|攻略|卡池|活动|任务|武器|圣遗物|道具)", t)]
    return out[:limit]


def fetch_page(wiki: str, title: str) -> dict | None:
    """抓一个角色页：生日 + 立绘"""
    try:
        data = api_get(wiki, {
            "action": "parse", "format": "json", "formatversion": "2",
            "page": title, "prop": "text", "section": "0", "disablelimitreport": "1",
        })
    except Exception:  # noqa: BLE001
        return None
    html = ((data.get("parse") or {}).get("text")) or ""
    if not html:
        return None
    plain = strip_html(html)
    bd = parse_birth(plain)

    # 图片必须能和角色对上：alt 含角色名，或文件名含角色名
    # （bwiki 很多页面共用同一张模板图，不做匹配就会串图）
    token = norm_name(title)
    best = None
    for tag in IMG_TAG_RE.findall(html):
        src = SRC_RE.search(tag)
        if not src:
            continue
        url = src.group(1)
        if BAD_IMG.search(url):
            continue
        alt = (ALT_RE.search(tag).group(1) if ALT_RE.search(tag) else "").strip()
        if not token:
            continue
        if token and (token in norm_name(alt) or token in norm_name(unquote(url))):
            best = (url, alt)
            break
    if not best:
        return None
    return {"title": title, "birth": bd, "image": best[0], "img_alt": best[1]}


WIKI_BY_WORK = {k: v["title"] for k, v in WIKIS.items()}


def wiki_of_char(char: dict) -> str | None:
    """角色主作品能对应到哪个 bwiki（没有就跳过，不做无谓请求）"""
    blob = " ".join([char.get("work") or "", char.get("work_cn") or ""]).lower()
    for wiki, meta in WIKIS.items():
        if meta["title"].lower() in blob:
            return wiki
    return None


def load_missing(limit: int) -> list[dict]:
    """从当前数据集里找出「还没图且作品能对上 bwiki」的角色（按人气降序）"""
    import csv
    import glob
    rows = []
    for path in sorted(glob.glob(os.path.join(os.path.dirname(RAW), "public", "data", "days", "*.csv"))):
        with open(path, encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                if r["image"]:
                    continue
                wiki = wiki_of_char({"work": r["work"], "work_cn": r["work_cn"]})
                if not wiki:
                    continue
                rows.append({"id": r["id"], "wiki": wiki, "month": int(r["month"]), "day": int(r["day"]),
                             "name_cn": r["name_cn"], "name_native": r["name_native"],
                             "heat": int(r["heat"] or 0)})
    rows.sort(key=lambda x: -x["heat"])
    return rows[:limit]


def fetch_by_targets(limit: int, workers: int, rps: float) -> list[dict]:
    """按缺口角色点名抓取：标题用中文名/日文名，生日对得上才采用（避免同名串图）"""
    targets = load_missing(limit)
    log(f"  bwiki 点名模式：缺图且作品对得上的角色 {len(targets)} 个")
    limiter = RateLimiter(rps=rps)
    out: list[dict] = []

    def work(t: dict):
        wiki = t["wiki"]
        for title in [x for x in (t["name_cn"], t["name_native"]) if x]:
            res = fetch_page(wiki, title)
            if not res:
                continue
            bd = res.get("birth")
            if bd and (bd[0], bd[1]) != (t["month"], t["day"]):
                continue                      # 生日对不上 → 判为同名不同人
            return {"wiki": wiki, "target": t, **res}
        return None

    def collect(res: dict) -> None:
        t = res["target"]
        out.append({
            "source": "bwiki",
            "source_id": f"bwiki-{res['wiki']}-{res['title']}",
            "name_cn": t["name_cn"] or res["title"],
            "name_native": t["name_native"],
            "name_romaji": "",
            "alt_names": [],
            "month": t["month"], "day": t["day"], "year": None,
            "gender": "", "blood_type": "", "collects": 0, "summary": "",
            "image": to_thumb(res["image"], 800, res.get("img_alt", "")),
            "image_medium": to_thumb(res["image"], 400, res.get("img_alt", "")),
            "url": f"https://wiki.biligame.com/{res['wiki']}/{quote(res['title'])}",
            "works": [{"id": None, "title": WIKIS[res["wiki"]]["title"], "title_cn": WIKIS[res["wiki"]]["title"],
                       "type": "游戏", "is_gal": False, "year": None, "rank": 0, "staff": "主角"}],
            "types": ["游戏"], "ptype": "游戏", "raw_type": "游戏", "nsfw": False,
            "match": {"title": res["title"], "birthday_matched": bool(res.get("birth"))},
        })

    parallel_map(targets, work, workers=workers, limiter=limiter, on_result=collect,
                 progress_every=50,
                 on_progress=lambda d, t, ok: log(f"    点名 {d}/{t}  命中 {len(out)}"),
                 label="bwiki")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit-per-wiki", type=int, default=300)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--rps", type=float, default=3.0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--mode", choices=["category", "targets"], default="targets",
                    help="category=按分类枚举；targets=按数据集缺口点名（默认，命中率更高）")
    args = ap.parse_args()

    if args.mode == "targets":
        rows = fetch_by_targets(args.limit_per_wiki * 10 if args.limit_per_wiki else 800,
                                args.workers, args.rps)
        log(f"点名模式完成：命中 {len(rows)} 条")
        if args.dry_run:
            for r in rows[:5]:
                log(f"   {r['name_cn']} {r['month']}/{r['day']} ← {r['image'][:70]}")
            return 0
        with open(OUT, "w", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        log(f"写入 {len(rows)} 条 → {OUT}")
        return 0

    limiter = RateLimiter(rps=args.rps)
    rows: list[dict] = []
    stats = {"pages": 0, "with_birth": 0, "with_image": 0}

    for wiki, meta in WIKIS.items():
        titles = list_members(wiki, meta["cats"], args.limit_per_wiki, limiter)
        log(f"  [{wiki}] {meta['title']}：候选页面 {len(titles)} 个")
        if not titles:
            continue

        def work(title: str, w=wiki):
            res = fetch_page(w, title)
            return {"wiki": w, **res} if res else None

        def collect(res: dict) -> None:
            stats["pages"] += 1
            bd = res.get("birth")
            if bd:
                stats["with_birth"] += 1
            if res.get("image"):
                stats["with_image"] += 1
            rows.append({
                "source": "bwiki",
                "source_id": f"bwiki-{res['wiki']}-{res['title']}",
                "name_cn": res["title"],
                "name_native": "",
                "name_romaji": "",
                "alt_names": [],
                "month": bd[0] if bd else None,
                "day": bd[1] if bd else None,
                "year": None,
                "gender": "",
                "blood_type": "",
                "collects": 0,
                "summary": "",
                "image": to_thumb(res["image"], 800, res.get("img_alt", "")),
                "image_medium": to_thumb(res["image"], 400, res.get("img_alt", "")),
                "url": f"https://wiki.biligame.com/{res['wiki']}/{quote(res['title'])}",
                "works": [{"id": None, "title": WIKIS[res["wiki"]]["title"], "title_cn": WIKIS[res["wiki"]]["title"],
                           "type": "游戏", "is_gal": False, "year": None, "rank": 0, "staff": "主角"}],
                "types": ["游戏"],
                "ptype": "游戏",
                "raw_type": "游戏",
                "nsfw": False,
            })

        parallel_map(titles, work, workers=args.workers, limiter=limiter,
                     on_result=collect, progress_every=50,
                     on_progress=lambda d, t, ok: log(f"    {wiki} {d}/{t} 页（含生日 {stats['with_birth']} / 含图 {stats['with_image']}）"),
                     label=wiki)

    useful = [r for r in rows if r["month"] and r["image"]]
    log(f"② 抓取完成：页面 {stats['pages']}，含生日 {stats['with_birth']}，含立绘 {stats['with_image']}，"
        f"两者都有 {len(useful)}")

    if args.dry_run:
        for r in useful[:5]:
            log(f"   {r['name_cn']} {r['month']}/{r['day']} ← {r['image'][:70]}")
        return 0

    with open(OUT, "w", encoding="utf-8") as fh:
        for r in useful:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    log(f"③ 写入 {len(useful)} 条 → {OUT}（build_dataset.py 会自动去重合并）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
