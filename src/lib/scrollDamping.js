/* ============================================================
   scrollDamping.js · 在「原生滚动」之上加阻尼感 / 平滑过渡 / 一点惯性
   ------------------------------------------------------------
   为什么不用「劫持滚轮」那套（上一版已删除）：
     · 它 preventDefault 掉 wheel，触控板惯性、键盘、滚动条都被改变，
       而且抽屉（.drawer-panel）内部滚动也一起被拦，体验整体变差。
   现在这套完全不动原生滚动：
     · 滚动条、滚轮、触控板惯性、键盘、锚点跳转、抽屉内部滚动 —— 全是浏览器原生行为
     · 浏览器照常滚动，我们只给内容加一层「视觉滞后」：
       内容用 transform 停在上一个平滑位置，再以缓动追上去
       → 视觉上就是阻尼（有拖拽感）+ 平滑过渡，停下后还会滑一小段（一点惯性）
     · 只作用在页面内容容器上，顶栏 / 抽屉 / Toast / 开屏都在容器外，互不影响
     · 触摸为主或开启「减少动效」时整段跳过
   ============================================================ */

/* 手感调参 */
const LERP = 0.14;      // 追赶系数：越小越黏（0.10 很飘，0.18 基本看不出来）
const MAX_LAG = 120;    // 最大滞后量（px）：防止快速滚动时内容脱节太多
const SETTLE = 0.3;     // 滞后小于这个值就归位并停止

export function enableScrollDamping(getWrapper, tune = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const mm = (q) => window.matchMedia?.(q)?.matches ?? false;
  if (mm('(prefers-reduced-motion: reduce)')) return () => {};
  // 触摸为主（手机/平板）：原生滚动本身就够顺，避免多余开销
  const touchPrimary = mm('(pointer: coarse)')
    && ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);
  if (touchPrimary) return () => {};

  const cfg = { lerp: LERP, maxLag: MAX_LAG, settle: SETTLE, ...tune };
  let smooth = window.scrollY;      // 「视觉上」的内容位置
  let raf = 0;
  let running = false;

  const reset = () => {
    const el = typeof getWrapper === 'function' ? getWrapper() : getWrapper;
    if (el) {
      el.style.transform = '';
      el.style.willChange = '';
    }
  };

  const tick = () => {
    const real = window.scrollY;
    smooth += (real - smooth) * cfg.lerp;
    let lag = real - smooth;
    if (Math.abs(lag) < cfg.settle) { smooth = real; reset(); running = false; raf = 0; return; }
    // 限幅：快速滚动时内容最多落后 maxLag
    lag = Math.max(-cfg.maxLag, Math.min(cfg.maxLag, lag));
    if (lag >= cfg.maxLag) smooth = real - cfg.maxLag;
    if (lag <= -cfg.maxLag) smooth = real + cfg.maxLag;
    const el = typeof getWrapper === 'function' ? getWrapper() : getWrapper;
    if (el) {
      el.style.willChange = 'transform';
      el.style.transform = `translate3d(0, ${lag.toFixed(2)}px, 0)`;
    }
    raf = requestAnimationFrame(tick);
  };

  const start = () => {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(tick);
  };

  const onScroll = () => start();
  const onResize = () => { smooth = window.scrollY; reset(); };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });

  return () => {
    if (raf) cancelAnimationFrame(raf);
    running = false;
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    reset();
  };
}
