"""受控并发工具：线程池 + 按站点的令牌桶限速。

原则：**并发 ≠ 猛冲**。不同站点互相独立可以同时跑，但同一个站点要有稳定的
请求速率上限（令牌桶）+ 抖动，失败自动退避；这样既快，也不会把对方站点打疼。

用法：
    from parallel import RateLimiter, parallel_map

    limiter = RateLimiter(rps=3)              # 该站点每秒最多 3 个请求
    parallel_map(items, do_one, workers=6, limiter=limiter, on_done=save)
"""

from __future__ import annotations

import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed


class RateLimiter:
    """令牌桶：保证长时间平均速率 ≤ rps，同时允许少量突发。"""

    def __init__(self, rps: float = 3.0, burst: int = 2):
        self.rps = max(0.1, rps)
        self.capacity = max(1, burst)
        self._tokens = float(self.capacity)
        self._last = time.monotonic()
        self._lock = threading.Lock()

    def acquire(self) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                self._tokens = min(self.capacity, self._tokens + (now - self._last) * self.rps)
                self._last = now
                if self._tokens >= 1:
                    self._tokens -= 1
                    wait = 0.0
                else:
                    wait = (1 - self._tokens) / self.rps
            if wait <= 0:
                return
            time.sleep(wait + random.uniform(0, 0.15))   # 抖动，避免整齐划一


def parallel_map(
    items: list,
    worker,
    *,
    workers: int = 6,
    limiter: RateLimiter | None = None,
    on_result=None,
    on_progress=None,
    progress_every: int = 50,
    label: str = "",
):
    """并发处理 items；worker(item) 的返回值交给 on_result（线程安全，串行回调）。

    返回 (结果列表, 成功数)。
    """
    results: list = []
    lock = threading.Lock()
    done = 0
    ok = 0

    def run(item):
        nonlocal done, ok
        if limiter is not None:
            limiter.acquire()
        try:
            out = worker(item)
        except Exception:  # noqa: BLE001 单个失败不影响整体
            out = None
        with lock:
            done += 1
            if out is not None:
                ok += 1
                results.append(out)
                if on_result is not None:
                    on_result(out)
            if on_progress and (done % progress_every == 0 or done == len(items)):
                on_progress(done, len(items), ok)
        return out

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = [pool.submit(run, it) for it in items]
        for f in as_completed(futures):
            f.result()

    if label and on_progress:
        on_progress(len(items), len(items), ok)
    return results, ok
