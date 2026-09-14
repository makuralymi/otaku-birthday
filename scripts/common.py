"""共用的 HTTP / JSONL 工具，零第三方依赖（仅标准库）。

所有抓取脚本都遵循同一约定：
- 每次请求之间 sleep，礼貌抓取，不并发冲击数据源
- 429 / 5xx 自动指数退避重试
- 结果以 JSONL 落盘到 raw/，天然支持断点续跑
"""

from __future__ import annotations

import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
DATA = os.path.join(ROOT, "public", "data")   # Vite 静态目录：public/ 会原样发布到站点根

UA = "otaku-birthday/1.0 (personal fan project; contact: local)"


def ensure_dirs() -> None:
    for d in (RAW, DATA):
        os.makedirs(d, exist_ok=True)


def log(*args: object) -> None:
    print(f"[{time.strftime('%H:%M:%S')}]", *args, flush=True)


def request(
    url: str,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    method: str | None = None,
    timeout: int = 45,
    retries: int = 5,
    accept_status: tuple[int, ...] = (200,),
) -> bytes:
    """带退避重试的 HTTP 请求，返回响应体 bytes。"""
    hdrs = {"User-Agent": UA, "Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    last_err: Exception | None = None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
                if resp.status in accept_status:
                    return body
                last_err = RuntimeError(f"HTTP {resp.status}")
        except urllib.error.HTTPError as e:  # noqa: PERF203
            body = e.read()[:300]
            last_err = RuntimeError(f"HTTP {e.code} {body!r}")
            if e.code in (429, 500, 502, 503, 504):
                wait = min(60.0, 2.0**attempt) + random.random()
                log(f"  ! HTTP {e.code}，{wait:.1f}s 后重试 ({url[:70]})")
                time.sleep(wait)
                continue
            raise
        except Exception as e:  # 网络抖动
            last_err = e
            wait = min(30.0, 1.5**attempt) + random.random()
            log(f"  ! {type(e).__name__}: {e}；{wait:.1f}s 后重试")
            time.sleep(wait)
    raise RuntimeError(f"请求失败 {url}: {last_err}")


def post_json(url: str, payload: dict, **kw) -> object:
    body = json.dumps(payload).encode("utf-8")
    raw = request(url, data=body, headers={"Content-Type": "application/json"}, method="POST", **kw)
    return json.loads(raw)


def get_json(url: str, **kw) -> object:
    return json.loads(request(url, **kw))


def read_jsonl(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    out = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return out


def append_jsonl(path: str, record: dict) -> None:
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def strip_html(text: str | None) -> str:
    if not text:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&quot;", '"').replace("&amp;", "&").replace("&#039;", "'")
    text = text.replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def norm_space(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def norm_name(text: str | None) -> str:
    """归一化姓名用于跨站点匹配：小写、去空白与中点等标点。"""
    if not text:
        return ""
    s = text.lower()
    s = re.sub(r"[\s·・.•\-–—_、,，.。/|()（）\[\]【】'\"`~!！?？:：;；]+", "", s)
    # ヶ/ヵ 在日文名里常被省略或替换（桐ヶ谷和人 ↔ 桐谷和人），匹配时统一去掉
    s = re.sub(r"[ヶヵゖ]", "", s)
    return s


def progress(done: int, total: int, extra: str = "") -> None:
    pct = done / total * 100 if total else 0
    bar = "#" * int(pct // 4) + "-" * (25 - int(pct // 4))
    sys.stdout.write(f"\r  [{bar}] {done}/{total} {extra:40s}")
    sys.stdout.flush()
    if done >= total:
        sys.stdout.write("\n")
