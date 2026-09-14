/* ============================================================
   smoothScroll.js · 全局惯性滚动（无级 + 湿滑手感）
   模型：滚轮把「速度」注入进来 → 每帧把速度累加到位置 → 速度按摩擦衰减。
   于是松手之后还会继续滑行、逐渐停下（惯性），而不是死死追一个目标点。

   与上一版（固定目标 + lerp 追赶）的区别：
     · 响应更快：滚轮后下一帧就开始动
     · 有惯性：一记滚轮会滑行一段距离后自然停下
     · 触控板：小步高频事件用更小的增益，避免「自己给自己加惯性」飞出去

   只在「触摸为主的设备」上关闭（手机/平板保留原生惯性滚动），
   键盘 / 滚动条 / 锚点跳转 / 控件内滚动都不受影响；尊重 prefers-reduced-motion。
   ============================================================ */

/* ── 手感调参（想更黏 / 更滑就改这里）────────────────────
   MOUSE_GAIN   鼠标滚轮每一格的注入系数（越大起步越快、滑得越远）
   TRACK_GAIN   触控板小步事件的注入系数（越小越不容易飞）
   FRICTION     每帧速度衰减（0.94 ≈ 很飘，0.90 ≈ 滑但不拖沓，0.86 ≈ 很快停）
   MAX_VELOCITY 速度上限（px/帧）
   MIN_VELOCITY 低于它就停，避免无限微动
   ──────────────────────────────────────────────────────── */
const MOUSE_GAIN = 0.30;
const TRACK_GAIN = 0.16;
const FRICTION = 0.90;      // 0.90：滑得动但尾段不拖沓（0.94 会很飘）
const MAX_VELOCITY = 150;
const MIN_VELOCITY = 0.35;  // 尾段收得干脆，避免「慢慢蹭」

export function enableSmoothScroll(tune = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const mm = (q) => window.matchMedia?.(q)?.matches ?? false;
  if (mm('(prefers-reduced-motion: reduce)')) return () => {};
  // 触摸为主（手机/平板）：保留原生惯性滚动，不劫持
  const touchPrimary = mm('(pointer: coarse)')
    && ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);
  if (touchPrimary) return () => {};

  const cfg = {
    mouseGain: MOUSE_GAIN,
    trackGain: TRACK_GAIN,
    friction: FRICTION,
    maxVelocity: MAX_VELOCITY,
    minVelocity: MIN_VELOCITY,
    ...tune,
  };

  let y = window.scrollY;        // 渲染位置
  let velocity = 0;              // 当前速度（px/帧）
  let raf = 0;
  let running = false;
  let selfScroll = false;

  const maxY = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const stop = () => {
    velocity = 0;
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const tick = () => {
    y += velocity;
    velocity *= cfg.friction;

    const limit = maxY();
    if (y <= 0) { y = 0; velocity = 0; }
    else if (y >= limit) { y = limit; velocity = 0; }

    selfScroll = true;
    window.scrollTo(0, Math.round(y));
    requestAnimationFrame(() => { selfScroll = false; });

    if (Math.abs(velocity) < cfg.minVelocity) { stop(); return; }
    if (!running) return;
    raf = requestAnimationFrame(tick);
  };

  const start = () => {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(tick);
  };

  const onWheel = (e) => {
    if (e.ctrlKey || e.metaKey) return;                    // 触控板缩放
    if (e.defaultPrevented || e.deltaMode === 2) return;   // 整页滚动交回浏览器
    const inWidget = e.target instanceof Element
      && e.target.closest('select, input, textarea, [data-native-scroll]');
    if (inWidget) return;

    e.preventDefault();
    const raw = e.deltaY * (e.deltaMode === 1 ? 16 : 1);   // 0=像素 1=行
    const gain = Math.abs(raw) < 40 ? cfg.trackGain : cfg.mouseGain;
    const injected = raw * gain;
    const before = velocity;
    // 方向突然反向：先清掉旧方向的惯性，才跟手
    velocity = (before * injected < 0) ? injected : before + injected;
    velocity = Math.max(-cfg.maxVelocity, Math.min(cfg.maxVelocity, velocity));
    if (!running) y = window.scrollY;
    // 当帧先走一步：不等 rAF，滚轮立刻有反馈（这一步也会让「迟到的 scroll 事件」看出是我们自己动的）
    y = Math.max(0, Math.min(maxY(), y + velocity));
    selfScroll = true;
    window.scrollTo(0, Math.round(y));
    requestAnimationFrame(() => { selfScroll = false; });
    start();
  };

  // 键盘 / 滚动条 / 锚点跳转：接管当前位置并清掉惯性。
  // 注意：程序化 scrollTo 产生的 scroll 事件可能是「迟到」的，
  // 若当前窗口位置与我们自己的 y 基本一致，说明是我们自己造成的，直接忽略，
  // 否则会把刚起步的惯性掐死（曾经导致「大滚动后滚轮无反应」）。
  const onScroll = () => {
    if (selfScroll) return;
    const real = window.scrollY;
    if (Math.abs(real - y) < 2) return;
    stop();
    y = real;
  };

  const onResize = () => { y = Math.min(y, maxY()); velocity = 0; };

  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });

  return () => {
    stop();
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
  };
}
