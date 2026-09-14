"""把 AniList / VNDB / Bangumi 的原始抓取结果合并成站点使用的 CSV 数据集。

产物：
  data/months/MM.csv     按月分片的角色数据（站点按需加载，每月一个 CSV）
  data/meta.json         统计元数据：每日/每月角色数（日历热力图）、来源统计、精选角色
  data/characters.csv    全量单文件 CSV（方便用 Excel / 脚本二次利用）
  raw/bangumi_queue.json 待补全中文信息的队列（交给 enrich_bangumi.py）

可反复执行：抓取脚本增量跑完后重新执行本脚本即可刷新数据集。
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

from common import DATA, RAW, ROOT, bgm_cid, log, norm_name, norm_space, read_jsonl

CORS_OK_DOMAINS = ("anilist.co", "bgm.tv")  # 这些图源允许 canvas 跨域取色，前端可实时取色

CAT_ANIME, CAT_MANGA, CAT_NOVEL, CAT_GAME, CAT_VN, CAT_OTHER = "动画", "漫画", "轻小说", "游戏", "Galgame", "其他"

ANILIST_FORMAT_CAT = {
    "NOVEL": CAT_NOVEL,
    "LIGHT_NOVEL": CAT_NOVEL,
    "MANGA": CAT_MANGA,
    "ONE_SHOT": CAT_MANGA,
    "GAME": CAT_GAME,
    "VIDEO_GAME": CAT_GAME,
}

MAX_VNDB_RECORDS = int(os.environ.get("BUILD_MAX_VNDB", "7000"))
VNDB_MIN_VOTES = int(os.environ.get("BUILD_VNDB_MIN_VOTES", "10"))
MAX_WORKS = 6
SUMMARY_LIMIT = 240
PALETTE_LIMIT = int(os.environ.get("BUILD_PALETTE_LIMIT", "1200"))

INDEX_COLUMNS = [
    "id", "src", "month", "day", "name_cn", "name_native", "name_romaji", "alt_names",
    "types", "ptype", "work", "work_cn", "work_year", "heat", "fav", "votes", "collects",
    "nsfw", "thumb", "image", "alts", "palette", "bgm_id", "url_al", "url_bgm", "url_vndb",
]

COLUMNS = [
    "id", "src", "month", "day", "year",
    "name_cn", "name_native", "name_romaji", "alt_names",
    "gender", "blood", "age", "types", "ptype",
    "work", "work_cn", "work_year", "work_fmt", "works",
    "summary", "heat", "fav", "votes", "collects", "nsfw",
    "image", "thumb", "alts", "palette", "tags",
    "url_al", "url_bgm", "url_vndb", "bgm_id",
]


# ─────────────────────────── 工具 ───────────────────────────


def classify_work(w: dict) -> str:
    if w.get("source") == "vndb":
        return CAT_VN
    fmt = (w.get("format") or "").upper()
    wtype = (w.get("type") or "").upper()
    if fmt in ANILIST_FORMAT_CAT:
        return ANILIST_FORMAT_CAT[fmt]
    if wtype == "ANIME":
        return CAT_ANIME
    if wtype == "MANGA":
        return CAT_MANGA
    if wtype == "NOVEL":
        return CAT_NOVEL
    return CAT_OTHER


def norm_gender(raw) -> str:
    if isinstance(raw, (list, tuple, set)):
        raw = ",".join(str(x) for x in raw if x)
    s = str(raw or "").strip().lower()
    if not s:
        return ""
    if s in ("f", "female", "f,f") or set(s.split(",")) == {"f"}:
        return "女"
    if s in ("m", "male", "m,m") or set(s.split(",")) == {"m"}:
        return "男"
    if s.startswith("n") and "binary" in s:
        return "其他"
    if {"m", "f"} <= set(s.split(",")):
        return "其他"
    return "其他" if s else ""


def short_summary(text: str) -> str:
    text = norm_space(text.replace("\r", " ").replace("\n", " "))
    text = re.sub(r"\s*_{2,}[^_]*_{2,}\s*", " ", text)  # 去掉 AniList 的 __Height:__ 标记
    text = re.sub(r"([A-Za-z]{3,}:\s*)", "", text)
    text = re.sub(r"\s{2,}", " ", text).strip()
    if len(text) <= SUMMARY_LIMIT:
        return text
    cut = text[:SUMMARY_LIMIT]
    for sep in ("。", "！", "？", ". ", "! ", "? "):
        idx = cut.rfind(sep)
        if idx > SUMMARY_LIMIT * 0.5:
            return cut[: idx + 1].strip()
    return cut.rstrip() + "…"


def year_of(text: str | None) -> int | None:
    m = re.search(r"(19|20)\d{2}", str(text or ""))
    return int(m.group(0)) if m else None


def heat_of(rec: dict) -> int:
    return max(int(rec.get("fav") or 0), int(rec.get("votes") or 0), int(rec.get("collects") or 0))


# ─────────────────────────── 归一化 ───────────────────────────


def from_anilist(raw: dict) -> dict:
    works = []
    for w in raw.get("works") or []:
        works.append(
            {
                "tid": w.get("id"),
                "t": w.get("title") or w.get("title_romaji") or "",
                "tr": w.get("title_romaji") or "",
                "cn": "",
                "ty": classify_work({"type": w.get("type"), "format": w.get("format")}),
                "y": w.get("year"),
                "pop": w.get("popularity") or 0,
                "src": "al",
            }
        )
    return {
        "src": "anilist",
        "sid": raw["source_id"],
        "ids": [f"al{raw['source_id']}"],
        "month": int(raw["month"]),
        "day": int(raw["day"]),
        "year": raw.get("year"),
        "name_native": raw.get("name_native") or "",
        "name_romaji": raw.get("name_romaji") or "",
        "name_cn": "",
        "alt_names": [a for a in (raw.get("alt_names") or []) if a][:6],
        "gender": norm_gender(raw.get("gender") or ""),
        "blood": raw.get("blood_type") or "",
        "age": str(raw.get("age") or ""),
        "summary": short_summary(raw.get("summary") or ""),
        "summary_lang": "en",
        "image": raw.get("image") or "",
        "thumb": raw.get("image_medium") or raw.get("image") or "",
        "alt_images": [raw.get("image_medium") or "", raw.get("image") or ""],
        "works": works,
        "fav": int(raw.get("favourites") or 0),
        "votes": 0,
        "collects": 0,
        "nsfw": False,
        "tags": [],
        "url_al": raw.get("url") or "",
        "url_vndb": "",
        "url_bgm": "",
        "bgm_id": "",
        "types": sorted({w["ty"] for w in works}) or [CAT_ANIME],
    }


def from_bwiki(raw: dict) -> dict:
    """B 站 wiki（bwiki）导入的游戏角色：中文名 + 生日 + 立绘。"""
    works = []
    for w in raw.get("works") or []:
        works.append({
            "tid": w.get("id"), "t": w.get("title") or "", "tr": "", "cn": w.get("title_cn") or "",
            "ty": CAT_GAME, "y": w.get("year"), "pop": 0, "rank": w.get("rank") or 0,
            "staff": w.get("staff") or "", "src": "bwiki",
        })
    return {
        "src": "bwiki",
        "sid": raw["source_id"],
        "ids": [raw["source_id"]],
        "month": int(raw["month"]),
        "day": int(raw["day"]),
        "year": None,
        "name_native": raw.get("name_native") or "",
        "name_romaji": raw.get("name_romaji") or "",
        "name_cn": raw.get("name_cn") or "",
        "alt_names": [a for a in (raw.get("alt_names") or []) if a][:6],
        "gender": norm_gender(raw.get("gender") or ""),
        "blood": (raw.get("blood_type") or "").upper()[:4],
        "age": "",
        "summary": short_summary(raw.get("summary") or ""),
        "summary_lang": "zh",
        "image": raw.get("image") or "",
        "thumb": raw.get("image_medium") or raw.get("image") or "",
        "alt_images": [],
        "works": works[:MAX_WORKS],
        "fav": 0, "votes": 0,
        "collects": int(raw.get("collects") or 0),
        "nsfw": bool(raw.get("nsfw")),
        "tags": ["来源:bwiki"],
        "url_al": "", "url_vndb": "", "url_bgm": "",
        "bgm_id": "",
        "url": raw.get("url") or "",
        "types": [CAT_GAME],
        "ptype": CAT_GAME,
    }


def from_bangumi_dump(raw: dict) -> dict:
    """Bangumi 官方 dump 导入的游戏角色（GalGame / 二次元游戏为主）。"""
    works = []
    for w in raw.get("works") or []:
        ty = w.get("type") or CAT_GAME
        if w.get("is_gal"):
            ty = CAT_VN
        works.append({
            "tid": w.get("id"),
            "t": w.get("title") or "",
            "tr": "",
            "cn": w.get("title_cn") or "",
            "ty": ty,
            "y": w.get("year"),
            "pop": 0,
            "rank": w.get("rank") or 0,
            "staff": w.get("staff") or "",
            "src": "bgm",
        })
    works.sort(key=lambda w: (w["ty"] != CAT_VN, w.get("rank") or 999999))
    types = []
    if any(w["ty"] == CAT_VN for w in works):
        types.append(CAT_VN)
    if any(w["ty"] == CAT_GAME for w in works):
        types.append(CAT_GAME)
    for t in (CAT_ANIME, CAT_MANGA, CAT_NOVEL):
        if any(w["ty"] == t for w in works):
            types.append(t)
    first_ty = types[0] if types else CAT_GAME
    return {
        "src": "bangumi",
        "sid": raw["source_id"],
        "ids": [f"bgm-{raw['source_id']}"],
        "month": int(raw["month"]),
        "day": int(raw["day"]),
        "year": raw.get("year"),
        "name_native": raw.get("name_native") or "",
        "name_romaji": raw.get("name_romaji") or "",
        "name_cn": raw.get("name_cn") or "",
        "alt_names": [a for a in (raw.get("alt_names") or []) if a][:6],
        "gender": norm_gender(raw.get("gender") or ""),
        "blood": (raw.get("blood_type") or "").upper()[:4],
        "age": "",
        "summary": short_summary(raw.get("summary") or ""),
        "summary_lang": "zh",
        "image": "",
        "thumb": "",
        "alt_images": [],
        "works": works[:MAX_WORKS],
        "fav": 0,
        "votes": 0,
        "collects": int(raw.get("collects") or 0),
        "nsfw": bool(raw.get("nsfw")),
        "tags": [],
        "url_al": "",
        "url_vndb": "",
        "url_bgm": raw.get("url") or "",
        "bgm_id": bgm_cid(raw),
        "types": types or [CAT_GAME],
        "ptype": first_ty,
    }


def from_vndb(raw: dict) -> dict:
    works = []
    for w in raw.get("works") or []:
        works.append(
            {
                "tid": w.get("id"),
                "t": w.get("title_alt") or w.get("title") or "",
                "tr": w.get("title") or "",
                "cn": "",
                "ty": CAT_VN,
                "y": year_of(w.get("released")),
                "pop": w.get("votes") or 0,
                "rating": w.get("rating") or 0,
                "dev": w.get("dev") or "",
                "src": "vndb",
            }
        )
    votes = max([w.get("pop") or 0 for w in works] or [0])
    return {
        "src": "vndb",
        "sid": raw["source_id"],
        "ids": [f"vndb-{raw['source_id']}"],
        "month": int(raw["month"]),
        "day": int(raw["day"]),
        "year": None,
        "name_native": raw.get("name_native") or "",
        "name_romaji": raw.get("name_romaji") or "",
        "name_cn": "",
        "alt_names": [a for a in (raw.get("alt_names") or []) if a][:6],
        "gender": norm_gender(raw.get("gender") or ""),
        "blood": (raw.get("blood_type") or "").upper(),
        "age": "",
        "summary": short_summary(raw.get("summary") or ""),
        "summary_lang": "en",
        "image": raw.get("image") or "",
        "thumb": raw.get("image_medium") or raw.get("image") or "",
        "alt_images": [raw.get("image_medium") or "", raw.get("image") or ""],
        "works": works,
        "fav": 0,
        "votes": votes,
        "collects": 0,
        "nsfw": False,
        "tags": [t for t in (raw.get("traits") or [])][:14],
        "url_al": "",
        "url_vndb": raw.get("url") or "",
        "url_bgm": "",
        "bgm_id": "",
        "types": [CAT_VN],
    }


# ─────────────────────────── 合并 ───────────────────────────


def merge_keys(rec: dict) -> list[str]:
    """一条记录可能有多个可用名字（日文原名 / 罗马音 / 中文名），任意一个对上就算同一角色。"""
    keys = []
    for field in ("name_native", "name_romaji", "name_cn"):
        n = norm_name(rec.get(field))
        if n and len(n) >= 2 and n not in keys:
            keys.append(n)
    return keys


def merge_into(base: dict, other: dict) -> dict:
    """同一角色的多来源数据合并。"""
    base["ids"] = sorted(set(base["ids"]) | set(other["ids"]))
    if not base.get("name_native") and other.get("name_native"):
        base["name_native"] = other["name_native"]
    if not base.get("name_romaji") and other.get("name_romaji"):
        base["name_romaji"] = other["name_romaji"]
    if not base.get("name_cn") and other.get("name_cn"):
        base["name_cn"] = other["name_cn"]
    base["alt_names"] = (base.get("alt_names") or []) + [a for a in (other.get("alt_names") or []) if a][:4]
    for f in ("fav", "votes", "collects"):
        base[f] = max(base.get(f) or 0, other.get(f) or 0)
    base.setdefault("alt_images", [])
    for url in [other.get("thumb"), other.get("image")] + list(other.get("alt_images") or []):
        if url:
            base["alt_images"].append(url)
    if not base.get("image") and other.get("image"):
        base["image"] = other["image"]
        base["thumb"] = other.get("thumb") or other["image"]
    # 中文简介优先，否则保留更长的简介
    if other.get("summary") and (not base.get("summary") or (other.get("summary_lang") == "zh" and base.get("summary_lang") != "zh")):
        base["summary"], base["summary_lang"] = other["summary"], other.get("summary_lang", "en")
    for f in ("url_al", "url_vndb", "url_bgm", "bgm_id", "blood", "year"):
        if not base.get(f) and other.get(f):
            base[f] = other[f]
    if not base.get("tags") and other.get("tags"):
        base["tags"] = other["tags"]
    existing = {(w.get("tid"), norm_name(w.get("tr") or w.get("t"))) for w in base["works"]}
    for w in other["works"]:
        key = (w.get("tid"), norm_name(w.get("tr") or w.get("t")))
        if key in existing:
            continue
        existing.add(key)
        w = dict(w)
        w["ty"] = w.get("ty") or CAT_OTHER
        base["works"].append(w)
    base["types"] = sorted(set(base["types"]) | set(other["types"]))
    return base


def dedupe(records: list[dict]) -> tuple[list[dict], int]:
    """同名 + 同生日判为同一角色；名字的任一写法（原名/罗马音/中文名）命中即合并。"""
    index: dict[tuple[str, int, int], dict] = {}
    out: list[dict] = []
    for rec in records:
        keys = merge_keys(rec)
        hit = None
        for k in keys:
            hit = index.get((k, rec["month"], rec["day"]))
            if hit is not None:
                break
        if hit is not None:
            merged = merge_into(hit, rec)
            for k in keys:                      # 新出现的写法也指向合并后的记录
                index[(k, rec["month"], rec["day"])] = merged
            continue
        for k in keys:
            index[(k, rec["month"], rec["day"])] = rec
        out.append(rec)
    return out, len(records) - len(out)


def finalize(rec: dict) -> dict:
    rec["works"].sort(key=lambda w: -(w.get("pop") or 0))
    rec["works"] = rec["works"][:MAX_WORKS]
    primary = rec["works"][0] if rec["works"] else None
    rec["ptype"] = primary["ty"] if primary else (rec["types"][0] if rec["types"] else CAT_OTHER)
    rec["work"] = primary["t"] if primary else ""
    rec["work_cn"] = primary.get("cn") or "" if primary else ""
    rec["work_year"] = primary.get("y") if primary else None
    rec["work_fmt"] = (primary.get("ty") if primary else "")
    rec["heat"] = heat_of(rec)
    # 备用图源线路：只保留「跨站」候选（同站不同尺寸不算线路，前端会自己拼镜像与代理）
    from urllib.parse import urlsplit

    def _host(url: str) -> str:
        try:
            return (urlsplit(url).hostname or "").lower()
        except ValueError:
            return ""

    rec["alts"] = []
    primary_host = _host(rec.get("image") or rec.get("thumb") or "")
    if primary_host:
        seen = {primary_host}
        for url in [rec.get("thumb"), rec.get("image")] + list(rec.get("alt_images") or []):
            if not url or not url.startswith("http"):
                continue
            host = _host(url)
            if not host or host in seen:
                continue
            seen.add(host)
            rec["alts"].append(url)
    rec["types"] = [t for t in [CAT_ANIME, CAT_MANGA, CAT_NOVEL, CAT_GAME, CAT_VN, CAT_OTHER] if t in rec["types"]]
    rec["id"] = rec["ids"][0]
    return rec


# ─────────────────────────── 莫奈调色板预计算（无 CORS 的图源） ───────────────────────────


def _proxies(url: str, width: int = 240) -> list[str]:
    """第三方镜像线路：仅在直连失败时使用（本地预计算同样遵守这个顺序）。"""
    try:
        from urllib.parse import urlsplit

        parts = urlsplit(url)
        if not parts.hostname:
            return []
        path = parts.path
        return [
            f"https://i0.wp.com/{parts.hostname}{path}?w={width}&quality=85",
            f"https://wsrv.nl/?url={parts.hostname}{path}&w={width}&output=webp&we",
        ]
    except Exception:  # noqa: BLE001
        return []


def palette_candidates(rec: dict) -> list[str]:
    out: list[str] = []
    for url in [rec.get("thumb"), rec.get("image")] + list(rec.get("alts") or []):
        if url and url.startswith("http") and url not in out:
            out.append(url)
    for url in list(out[:2]):
        for mirror in _proxies(url, 240):
            if mirror not in out:
                out.append(mirror)
    return out


def needs_palette(image: str) -> bool:
    return bool(image) and not any(d in image for d in CORS_OK_DOMAINS)


def kmeans_palette(img, k: int = 6) -> list[str]:
    """对缩略图做 k-means 取色，返回按「色彩存在感」排序的 hex 列表。

    评分兼顾三件事：色彩饱和度、区域占比、以及明度是否落在中间调
    （太亮多半是背景、太暗多半是头发/线稿，都不该主导整张卡片）。
    """
    small = img.convert("RGB").resize((72, 72))
    pixels = list(small.getdata())
    if not pixels:
        return []
    step = max(1, len(pixels) // k)
    centers = [list(map(float, pixels[i * step])) for i in range(k) if i * step < len(pixels)]
    buckets: list[list[tuple[int, int, int]]] = [[] for _ in centers]
    for _ in range(14):
        buckets = [[] for _ in centers]
        for px in pixels:
            best, best_d = 0, 1 << 30
            for i, c in enumerate(centers):
                d = (px[0] - c[0]) ** 2 + (px[1] - c[1]) ** 2 + (px[2] - c[2]) ** 2
                if d < best_d:
                    best, best_d = i, d
            buckets[best].append(px)
        moved = False
        for i, bucket in enumerate(buckets):
            if not bucket:
                continue
            avg = [sum(p[j] for p in bucket) / len(bucket) for j in range(3)]
            if max(abs(avg[j] - centers[i][j]) for j in range(3)) > 1.5:
                moved = True
            centers[i] = avg
        if not moved:
            break

    total = len(pixels)
    scored: list[tuple[float, tuple[int, int, int]]] = []
    for i, center in enumerate(centers):
        weight = len(buckets[i]) / total
        if weight < 0.02:
            continue
        rgb = tuple(int(round(v)) for v in center)
        r, g, b = rgb
        mx, mn = max(rgb), min(rgb)
        sat = 0.0 if mx == 0 else (mx - mn) / mx
        lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        balance = max(1 - abs(lum - 0.55) * 1.25, 0.06)
        neutral = 0.25 if sat < 0.06 else 1.0
        scored.append((sat * balance * neutral * (0.35 + min(weight * 4, 1)), rgb))
    scored.sort(key=lambda x: -x[0])

    out: list[str] = []
    for _, rgb in scored:
        if any(sum(abs(rgb[j] - int(hex_[j * 2 + 1 : j * 2 + 3], 16)) for j in range(3)) < 24 for hex_ in out):
            continue  # 跳过肉眼几乎相同的颜色
        out.append("#%02x%02x%02x" % rgb)
        if len(out) >= k:
            break
    return out


def palette_pass(records: list[dict]) -> dict[str, list[str]]:
    cache_path = os.path.join(RAW, "palette_cache.json")
    cache: dict[str, list[str]] = {}
    if os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as fh:
            cache = json.load(fh)
    todo = [r for r in records if needs_palette(r.get("thumb") or r.get("image")) and (r.get("thumb") or r.get("image")) not in cache]
    todo.sort(key=lambda r: -r["heat"])
    todo = todo[:PALETTE_LIMIT]
    if not todo:
        log(f"调色板：缓存已覆盖 {len(cache)} 张图片，无需新增")
        return cache
    log(f"调色板：需要为 {len(todo)} 张图（无 CORS 图源）预计算莫奈色板")

    try:
        import io
        import urllib.request

        from PIL import Image
    except ImportError:
        log("  ! 缺少 Pillow，跳过调色板预计算（前端会退化为色相生成）")
        return cache

    lock = __import__("threading").Lock()
    done = 0

    def work(rec: dict) -> None:
        nonlocal done
        url = rec.get("thumb") or rec.get("image")
        palette: list[str] = []
        # 多线路兜底：直连 → 各备用图源 → 两个镜像代理
        for candidate in palette_candidates(rec):
            try:
                req = urllib.request.Request(candidate, headers={"User-Agent": "otaku-birthday/1.0"})
                data = urllib.request.urlopen(req, timeout=25).read()
                palette = kmeans_palette(Image.open(io.BytesIO(data)))
                if palette:
                    break
            except Exception:  # noqa: BLE001
                continue
        with lock:
            cache[url] = palette
            done += 1
            if done % 25 == 0:
                log(f"  调色板进度 {done}/{len(todo)}")
                with open(cache_path, "w", encoding="utf-8") as fh:
                    json.dump(cache, fh)

    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(work, todo))
    with open(cache_path, "w", encoding="utf-8") as fh:
        json.dump(cache, fh)
    ok = sum(1 for r in todo if cache.get(r.get("thumb") or r.get("image")))
    log(f"调色板：完成 {ok}/{len(todo)}，缓存共 {len(cache)} 张")
    return cache


# ─────────────────────────── 输出 ───────────────────────────


def to_row(rec: dict, palette: dict[str, list[str]]) -> dict:
    img = rec.get("image") or ""
    thumb = rec.get("thumb") or img
    pal = " ".join(palette.get(thumb) or palette.get(img) or [])
    works = [
        {
            "t": w.get("t") or "",
            "cn": w.get("cn") or "",
            "ty": w.get("ty") or "",
            "y": w.get("y") or "",
            "pop": w.get("pop") or 0,
        }
        for w in rec["works"][:MAX_WORKS]
    ]
    return {
        "id": rec["id"],
        "src": rec["src"],
        "month": rec["month"],
        "day": rec["day"],
        "year": rec.get("year") or "",
        "name_cn": rec.get("name_cn") or "",
        "name_native": rec.get("name_native") or "",
        "name_romaji": rec.get("name_romaji") or "",
        "alt_names": " / ".join((rec.get("alt_names") or [])[:4]),
        "gender": rec.get("gender") or "",
        "blood": rec.get("blood") or "",
        "age": rec.get("age") or "",
        "types": "|".join(rec["types"]),
        "ptype": rec.get("ptype") or "",
        "work": rec.get("work") or "",
        "work_cn": rec.get("work_cn") or "",
        "work_year": rec.get("work_year") or "",
        "work_fmt": rec.get("work_fmt") or "",
        "works": json.dumps(works, ensure_ascii=False, separators=(",", ":")) if len(works) > 1 else "",
        "summary": rec.get("summary") or "",
        "heat": rec.get("heat") or 0,
        "fav": rec.get("fav") or 0,
        "votes": rec.get("votes") or 0,
        "collects": rec.get("collects") or 0,
        "nsfw": "1" if rec.get("nsfw") else "",
        "image": img,
        "thumb": thumb,
        "alts": "|".join(rec.get("alts") or []),
        "palette": pal,
        "tags": " ".join((rec.get("tags") or [])[:10]),
        "url_al": rec.get("url_al") or "",
        "url_bgm": rec.get("url_bgm") or "",
        "url_vndb": rec.get("url_vndb") or "",
        "bgm_id": rec.get("bgm_id") or "",
    }


def main(single: bool = False) -> None:
    t0 = time.time()
    anilist = [from_anilist(r) for r in read_jsonl(os.path.join(RAW, "anilist.jsonl"))]
    bangumi_rows = [from_bangumi_dump(r) for r in read_jsonl(os.path.join(RAW, "bangumi_dump.jsonl"))]
    bwiki_rows = [from_bwiki(r) for r in read_jsonl(os.path.join(RAW, "bwiki.jsonl"))]
    if bwiki_rows:
        log(f"读取原始数据：bwiki {len(bwiki_rows)} 条（B 站 wiki 游戏角色）")
    log(f"读取原始数据：Bangumi dump {len(bangumi_rows)} 条（游戏角色）")
    vndb_all = [from_vndb(r) for r in read_jsonl(os.path.join(RAW, "vndb.jsonl"))]
    log(f"读取原始数据：AniList {len(anilist)} 条，VNDB {len(vndb_all)} 条")

    vndb = [r for r in vndb_all if (r["votes"] or 0) >= VNDB_MIN_VOTES]
    vndb.sort(key=lambda r: -(r["votes"] or 0))
    if len(vndb) > MAX_VNDB_RECORDS:
        log(f"VNDB 超过上限，按人气保留前 {MAX_VNDB_RECORDS} 条（阈值调整见 BUILD_MAX_VNDB）")
        vndb = vndb[:MAX_VNDB_RECORDS]
    log(f"VNDB 过滤后保留 {len(vndb)} 条（最佳 VN 投票数 ≥ {VNDB_MIN_VOTES}）")

    # 合并按 id 补来的 Bangumi 立绘 / 简介（scripts/enrich_bangumi_ids.py 生成）
    images_path = os.path.join(RAW, "bangumi_images.jsonl")
    if os.path.exists(images_path):
        by_id = {bgm_cid(r): r for r in read_jsonl(images_path) if bgm_cid(r)}
        hit = 0
        for rec in bangumi_rows:
            info = by_id.get(bgm_cid(rec))
            if not info:
                continue
            if info.get("image"):
                rec["image"] = info["image"]
                rec["thumb"] = info.get("image_medium") or info["image"]
                hit += 1
            if info.get("summary") and len(info["summary"]) > len(rec.get("summary") or ""):
                rec["summary"] = short_summary(info["summary"])
                rec["summary_lang"] = "zh"
            if info.get("collects"):
                rec["collects"] = max(rec.get("collects") or 0, int(info["collects"]))
            if info.get("nsfw"):
                rec["nsfw"] = True
        log(f"Bangumi 立绘补全：{hit} 个角色")

    # 合并多源补图（scripts/fetch_extra_images.py：萌娘百科 / Fandom / VNDB）
    extra_path = os.path.join(RAW, "images_extra.jsonl")
    if os.path.exists(extra_path):
        extra = {str(r.get("id")): r for r in read_jsonl(extra_path) if r.get("image")}
        hit = 0
        for rec in anilist + vndb + bangumi_rows + bwiki_rows:   # 注意：此处 records 还没合并
            info = extra.get(rec["ids"][0]) or extra.get(str(rec.get("sid") or ""))
            if not info:
                continue
            src = info.get("source") or "extra"
            if not rec.get("image"):
                rec["image"] = info["image"]
                rec["thumb"] = info.get("thumb") or info["image"]
                hit += 1
            else:
                # 已有图时把新来源排进备用线路（前端多线路兜底会用到）
                for url in (info.get("thumb"), info.get("image")):
                    if url and url not in (rec.get("alt_images") or []):
                        rec.setdefault("alt_images", []).append(url)
            rec.setdefault("tags", [])
            if src and src not in rec["tags"]:
                rec["tags"] = ([f"图源:{src}"] + rec["tags"])[:14]
        log(f"多源补图：{hit} 条角色补到了立绘（缓存 {len(extra)} 条）")

    # 合并 R18 标记（scripts/flag_nsfw.py 生成）
    nsfw_path = os.path.join(RAW, "vndb_nsfw.json")
    if os.path.exists(nsfw_path):
        with open(nsfw_path, encoding="utf-8") as fh:
            vndb_nsfw = json.load(fh)
        hit = 0
        for rec in anilist + vndb:
            if rec["src"] == "vndb" and vndb_nsfw.get(rec["sid"]):
                rec["nsfw"] = True
                hit += 1
        log(f"R18 标记：{hit} 个 VNDB 角色默认隐藏")

    records = anilist + vndb + bangumi_rows + bwiki_rows
    records, dup = dedupe(records)
    log(f"跨源去重合并 {dup} 条，剩余 {len(records)} 条")

    # 丢弃非法生日（例如某 GalGame 愚人节角色的 2 月 30 日）
    dim = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    valid = [r for r in records if 1 <= r["month"] <= 12 and 1 <= r["day"] <= dim[r["month"]]]
    if len(valid) != len(records):
        dropped = [f'{r["name_romaji"]}({r["month"]}/{r["day"]})' for r in records if r not in valid]
        log(f"丢弃 {len(dropped)} 条非法生日记录：{', '.join(dropped[:5])}")
    records = [finalize(r) for r in valid]

    # 应用 Bangumi 中文补全
    enrich_path = os.path.join(RAW, "bangumi.jsonl")
    enrich = read_jsonl(enrich_path)
    # 全局作品名映射：任何角色只要作品被别处翻译过，就能拿到中文名
    work_cn_map: dict[str, str] = {}
    for e in enrich:
        for w in e.get("works") or []:
            if w.get("name") and w.get("name_cn"):
                work_cn_map.setdefault(norm_name(w["name"]), w["name_cn"])
    applied = 0
    if enrich:
        index: dict[str, dict] = {}
        for e in enrich:
            if e.get("matched"):
                index[norm_name(e.get("key"))] = e
        for rec in records:
            hit = index.get(norm_name(rec.get("name_native"))) or index.get(norm_name(rec.get("name_romaji")))
            if not hit:
                continue
            applied += 1
            rec["name_cn"] = hit.get("name_cn") or rec.get("name_cn") or ""
            rec["bgm_id"] = str(hit.get("bgm_id") or "")
            if rec["bgm_id"]:
                rec["url_bgm"] = f"https://bgm.tv/character/{rec['bgm_id']}"
            for url in (hit.get("image_medium"), hit.get("image")):
                if url:
                    rec.setdefault("alt_images", []).append(url)
            if hit.get("image") and not rec.get("image"):
                rec["image"] = hit["image"]
                rec["thumb"] = hit.get("image_medium") or hit["image"]
            if hit.get("summary"):
                rec["summary"] = short_summary(hit["summary"])
                rec["summary_lang"] = "zh"
            rec["collects"] = max(rec.get("collects") or 0, int(hit.get("collects") or 0))
            if not rec.get("gender") and hit.get("gender"):
                rec["gender"] = norm_gender(hit["gender"])
            if not rec.get("blood") and hit.get("blood_type"):
                rec["blood"] = str(hit["blood_type"])
            if hit.get("nsfw"):
                rec["nsfw"] = True
            for w in hit.get("works") or []:
                norm = norm_name(w.get("name") or "")
                for rw in rec["works"]:
                    if norm_name(rw.get("t")) == norm or norm_name(rw.get("tr")) == norm:
                        rw["cn"] = rw.get("cn") or w.get("name_cn") or ""
                else:
                    pass
    log(f"Bangumi 补全：命中 {applied} 个角色（缓存 {len(enrich)} 条，作品名映射 {len(work_cn_map)} 条）")

    work_hits = 0
    for rec in records:
        for w in rec["works"]:
            for key in (w.get("t"), w.get("tr")):
                cn = work_cn_map.get(norm_name(key)) if key else None
                if cn and not w.get("cn"):
                    w["cn"] = cn
                    work_hits += 1
                    break
    log(f"作品中文名回填：{work_hits} 部作品")

    # 补全之后再跑一轮去重：AniList/VNDB 记录的中文名往往是这一步才填上的，
    # 此时「中文名相同 + 同生日」的跨源重复才暴露出来
    records, dup2 = dedupe(records)
    if dup2:
        log(f"补全后二次去重：又合并 {dup2} 条")

    # 补全之后重新 finalize：中文名、作品名、备用图源线路都可能变了
    records = [finalize(r) for r in records]
    records.sort(key=lambda r: (-r["heat"], r["month"], r["day"], r["name_romaji"]))

    palette = palette_pass(records)

    # 写按天分片 CSV：站点一次只查一天，几十 KB 就能搞定，数据量再大也不影响首屏
    days_dir = os.path.join(DATA, "days")
    os.makedirs(days_dir, exist_ok=True)
    for old in os.listdir(days_dir):
        if old.endswith(".csv"):
            os.remove(os.path.join(days_dir, old))
    buckets: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for rec in records:
        buckets[(rec["month"], rec["day"])].append(rec)
    day_rows = 0
    day_bytes = 0
    for (m, d), items in sorted(buckets.items()):
        items.sort(key=lambda r: -r["heat"])
        path = os.path.join(days_dir, f"{m:02d}{d:02d}.csv")
        with open(path, "w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=COLUMNS)
            writer.writeheader()
            for rec in items:
                writer.writerow(to_row(rec, palette))
        day_rows += len(items)
        day_bytes += os.path.getsize(path)
    log(f"  data/days/MMDD.csv  {len(buckets)} 个文件  {day_rows} 行  {day_bytes/1024/1024:.1f} MB"
        f"（最大 {max(os.path.getsize(os.path.join(days_dir, f)) for f in os.listdir(days_dir))/1024:.0f} KB）")

    # 搜索索引：瘦身版（无简介 / 无作品明细），跨月搜索与分片兜底都用它
    index_path = os.path.join(DATA, "search-index.csv")
    with open(index_path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=INDEX_COLUMNS)
        writer.writeheader()
        for rec in records:
            row = to_row(rec, palette)
            writer.writerow({k: row.get(k, "") for k in INDEX_COLUMNS})
    log(f"  data/search-index.csv  {len(records)} 行  {os.path.getsize(index_path)/1024/1024:.1f} MB")

    if single:
        months_dir = os.path.join(DATA, "months")
        os.makedirs(months_dir, exist_ok=True)
        for month in range(1, 13):
            items = [r for r in records if r["month"] == month]
            path = os.path.join(months_dir, f"{month:02d}.csv")
            with open(path, "w", encoding="utf-8", newline="") as fh:
                writer = csv.DictWriter(fh, fieldnames=COLUMNS)
                writer.writeheader()
                for rec in sorted(items, key=lambda r: (r["day"], -r["heat"])):
                    writer.writerow(to_row(rec, palette))
        all_path = os.path.join(DATA, "characters.csv")
        with open(all_path, "w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=COLUMNS)
            writer.writeheader()
            for rec in records:
                writer.writerow(to_row(rec, palette))
        log(f"  data/characters.csv  {len(records)} 行  {os.path.getsize(all_path)/1024/1024:.1f} MB"
            f" + data/months/*.csv（--single 附加产物）")

    # meta.json
    days = [[0] * 32 for _ in range(13)]
    type_counts: dict[str, int] = {}
    src_counts: dict[str, int] = {}
    for rec in records:
        days[rec["month"]][rec["day"]] += 1
        for t in rec["types"]:
            type_counts[t] = type_counts.get(t, 0) + 1
        src_counts[rec["src"]] = src_counts.get(rec["src"], 0) + 1
    featured = []
    seen_featured: set[str] = set()
    for rec in records:
        if rec["nsfw"] or len(featured) >= 30:
            continue
        key = norm_name(rec.get("name_native"))[:3]
        if key in seen_featured:
            continue
        seen_featured.add(key)
        row = to_row(rec, palette)
        featured.append(
            {
                "id": row["id"],
                "n": row["name_cn"] or row["name_native"] or row["name_romaji"],
                "nn": row["name_native"],
                "m": row["month"],
                "d": row["day"],
                "ty": row["ptype"],
                "w": row["work_cn"] or row["work"],
                "img": row["thumb"],
                "p": row["palette"],
            }
        )
    meta = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "total": len(records),
        "sources": src_counts,
        "types": type_counts,
        "months": [sum(days[m][1:32]) for m in range(1, 13)],
        "days": days[1:],
        "days_flat": [days[m][d] for m in range(1, 13) for d in range(1, 32)],
        "nsfw": sum(1 for r in records if r["nsfw"]),
        "max_day": max(max(d[1:32]) for d in days[1:]),
        "featured": featured,
        "columns": COLUMNS,
    }
    with open(os.path.join(DATA, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, separators=(",", ":"))

    # 中文补全队列
    queue = [
        {
            "id": r["id"],
            "key": r.get("name_native") or r.get("name_romaji"),
            "romaji": r.get("name_romaji") or "",
            "month": r["month"],
            "day": r["day"],
            "src": r["src"],
            "heat": r["heat"],
            "works": [w.get("t") or w.get("tr") for w in r["works"][:3]],
        }
        for r in records
        if not r.get("name_cn") and not r.get("bgm_id")
    ]
    with open(os.path.join(RAW, "bangumi_queue.json"), "w", encoding="utf-8") as fh:
        json.dump(queue, fh, ensure_ascii=False)
    log(f"  待中文补全队列：{len(queue)} 条 → raw/bangumi_queue.json")
    log(f"  来源分布：anilist={sum(1 for r in records if r['src']=='anilist')} "
        f"vndb={sum(1 for r in records if r['src']=='vndb')} "
        f"bangumi={sum(1 for r in records if r['src']=='bangumi')} "
        f"bwiki={sum(1 for r in records if r['src']=='bwiki')}")

    log(f"完成，共 {len(records)} 个角色，用时 {time.time()-t0:.1f}s")
    log("来源分布：" + ", ".join(f"{k}={v}" for k, v in src_counts.items()))
    log("类型分布：" + ", ".join(f"{k}={v}" for k, v in sorted(type_counts.items(), key=lambda x: -x[1])))
    dim = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    empty_days = [f"{m}-{d}" for m in range(1, 13) for d in range(1, dim[m] + 1) if days[m][d] == 0]
    log(f"无角色日期：{len(empty_days)} 天 {empty_days[:12]}")


if __name__ == "__main__":
    sys.exit(main(single="--single" in sys.argv))
