/* ============================================================
   smoothScroll.js · 全局「无级」平滑滚动
   把滚轮的离散跳变改成带缓动的连续位移（lerp），滚起来更顺；
   只在「精确指针设备（鼠标/触控板）+ 未开启减少动效」时启用：
     · 触摸屏保持原生惯性滚动，绝不劫持
     · 键盘 / 滚动条 / 锚点跳转仍然可用（原生滚动会被同步回目标值）
     · 输入框、下拉框等控件内的滚轮不拦截
   ============================================================ */

export function enableSmoothScroll({ factor = 0.12, maxStep = 520 } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const mm = (q) => window.matchMedia?.(q)?.matches ?? false;
  if (mm('(prefers-reduced-motion: reduce)')) return () => {};
  // 只在「触摸为主的设备」上关闭：手机/平板保留原生惯性滚动。
  // （不用 (pointer: fine) 判断——部分桌面环境/无头浏览器会报 none，会被误伤）
  const touchPrimary = mm('(pointer: coarse)')
    && ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);
  if (touchPrimary) return () => {};

  let target = window.scrollY;
  let current = target;
  let running = false;
  let selfScroll = false;
  let raf = 0;

  const maxY = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const clamp = (v) => Math.max(0, Math.min(maxY(), v));

  const tick = () => {
    current += (target - current) * factor;
    const settled = Math.abs(target - current) < 0.5;
    if (settled) current = target;
    selfScroll = true;
    window.scrollTo(0, Math.round(current));
    raf = requestAnimationFrame(() => { selfScroll = false; });
    if (settled) { running = false; return; }
    raf = requestAnimationFrame(tick);
  };

  const start = () => {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(tick);
  };

  const onWheel = (e) => {
    if (e.ctrlKey || e.metaKey) return;                    // 触控板缩放
    if (e.defaultPrevented || e.deltaMode === 2) return;   // 整页滚动（少见）交回浏览器
    const inWidget = e.target instanceof Element
      && e.target.closest('select, input, textarea, [data-native-scroll]');
    if (inWidget) return;                                  // 控件内滚动不劫持
    e.preventDefault();
    const step = Math.max(-maxStep, Math.min(maxStep, e.deltaY));
    target = clamp(target + step);
    if (!running) current = window.scrollY;                // 从当前位置接着滚
    start();
  };

  const onScroll = () => {
    if (selfScroll) return;                                // 我们自己发的 scrollTo，忽略
    target = window.scrollY;                                // 键盘 / 滚动条 / 锚点
    current = window.scrollY;
  };

  const onResize = () => { target = clamp(target); current = clamp(current); };

  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
  };
}
