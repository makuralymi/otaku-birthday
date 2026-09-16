/* ============================================================
   scrollSpring.js · 滚动平滑（速度驱动的弹簧-阻尼模型，全新实现）
   ------------------------------------------------------------
   设计取舍（为什么是这套）：

     ① 绝不劫持滚动
        不监听 wheel、不 preventDefault。滚轮 / 触控板惯性 / 键盘 /
        滚动条拖动 / 锚点跳转全部保持浏览器原生行为，抽屉（.drawer-panel）
        这类自滚动区域也完全不受影响。

     ② 不用「位置滞后」那套（已废弃）
        旧做法是让内容位置 `smooth` 去追 `window.scrollY`，本质是
        一阶低通：滞后量与「累计滚动距离」相关，滚得越远越拖，
        长距离滚动时会明显脱节。

     ③ 现在：物理二阶系统（弹簧 + 阻尼）
        · 每帧只读 window.scrollY，用帧间位移差分出瞬时滚动速度 v，
          再取「最近 5 帧均值」去抖（滚轮是一格一格跳的，原始速度很毛）
        · 速度 → 目标偏移 target = clamp(v * GAIN, ±MAX_OFFSET)
          滚得越快，内容越「落后」一点点（阻尼感就来自这里）
        · 偏移量 x 由 ζ、ω 决定的二阶系统平滑逼近 target：
              a = ω²(target − x) − 2ζω·vx
          起步柔和、收尾带一点过冲 → 这一点过冲就是「一点惯性」
        · 偏移有硬上限；回到静止阈值内立即归零、清掉 transform、停掉 rAF
          （静止时页面不残留合成层，也不占用主线程）

     ④ 触摸为主 / 开启「减少动效」→ 整段跳过
   ============================================================ */

const OMEGA = 11;        // 固有角频率 ω(rad/s)：越大回位越快、越干脆
const ZETA = 0.55;       // 阻尼比 ζ：<1 会过冲 —— 收尾那点回弹就是「一点惯性」
const GAIN = 0.014;      // 速度→偏移 换算（秒）：1000px/s ≈ 14px
const MAX_OFFSET = 34;   // 视觉偏移上限（px）：快速滚动也不会脱节
const REST_X = 0.35;     // 偏移小于该值（亚像素，肉眼不可见）…
const REST_V = 0.8;      // …且偏移速度也小于该值 → 判定静止并归零
const VEL_WIN = 5;       // 滚动速度用「最近 N 帧均值」：滚动中稳，停止后 ~80ms 归零
const MAX_DT = 1 / 30;   // 单帧最大步长（掉帧保护）
const SUBSTEPS = 3;      // 每帧内部子步数（数值稳定）

export function enableScrollSpring(getWrapper, tune = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const mq = (q) => (typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false);
  if (mq('(prefers-reduced-motion: reduce)')) return () => {};
  // 触摸为主（手机/平板）：原生滚动已足够顺，不必再叠一层
  const touchPrimary = mq('(pointer: coarse)')
    && ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);
  if (touchPrimary) return () => {};

  const cfg = {
    omega: OMEGA, zeta: ZETA, gain: GAIN, max: MAX_OFFSET,
    restX: REST_X, restV: REST_V, win: VEL_WIN, ...tune,
  };

  const node = () => (typeof getWrapper === 'function' ? getWrapper() : getWrapper);

  let raf = 0;
  let x = 0;                 // 当前视觉偏移（px，正 = 内容偏下 = 落后）
  let vx = 0;                // 偏移自身的速度
  let lastY = window.scrollY;
  // 速度滑窗：滑动均值比指数低通更抗「滚轮一格一格跳」的毛刺，
  // 而且一旦停手，窗口在 ~80ms 内清空 → 目标偏移迅速归零，
  // 弹簧于是做一次阶跃响应，收尾带一点回弹（惯性来源）
  const win = Math.max(1, Math.round(cfg.win));
  const velBuf = new Float64Array(win);
  let velSum = 0;
  let velIdx = 0;
  let velFill = 0;
  let tPrev = 0;

  const paint = () => {
    const el = node();
    if (!el) return;
    if (el.style.willChange !== 'transform') el.style.willChange = 'transform';
    el.style.transform = `translate3d(0, ${x.toFixed(2)}px, 0)`;
  };

  const clear = () => {
    const el = node();
    if (el) {
      el.style.transform = '';
      el.style.willChange = '';
    }
  };

  const reset = () => {
    lastY = window.scrollY;
    x = 0; vx = 0;
    velBuf.fill(0); velSum = 0; velIdx = 0; velFill = 0;
    clear();
  };

  const step = (now) => {
    const dt = Math.min(MAX_DT, Math.max(1 / 240, ((now - tPrev) / 1000) || 1 / 60));
    tPrev = now;

    // ① 原生滚动位置 → 瞬时速度 → 滑窗均值
    const yNow = window.scrollY;
    const vInst = (yNow - lastY) / dt;
    lastY = yNow;
    velSum -= velBuf[velIdx];
    velBuf[velIdx] = vInst;
    velSum += vInst;
    velIdx = (velIdx + 1) % win;
    if (velFill < win) velFill += 1;
    const vScroll = velSum / velFill;

    // ② 速度 → 目标偏移（滚得越快越落后），带硬上限
    const target = Math.max(-cfg.max, Math.min(cfg.max, vScroll * cfg.gain));

    // ③ 二阶弹簧-阻尼积分（子步，掉帧也稳）
    const h = dt / SUBSTEPS;
    for (let i = 0; i < SUBSTEPS; i += 1) {
      const a = cfg.omega * cfg.omega * (target - x) - 2 * cfg.zeta * cfg.omega * vx;
      vx += a * h;
      x += vx * h;
    }
    if (x > cfg.max) { x = cfg.max; if (vx > 0) vx = 0; }
    if (x < -cfg.max) { x = -cfg.max; if (vx < 0) vx = 0; }

    // ④ 静止判定：目标、偏移、偏移速度都足够小 → 归零、清 transform、停机
    if (Math.abs(target) < cfg.restX && Math.abs(x) < cfg.restX && Math.abs(vx) < cfg.restV) {
      x = 0; vx = 0;
      velBuf.fill(0); velSum = 0; velFill = 0; velIdx = 0;
      clear();
      raf = 0;
      return;
    }

    paint();
    raf = requestAnimationFrame(step);
  };

  const start = () => {
    if (raf) return;
    tPrev = performance.now();
    raf = requestAnimationFrame(step);
  };

  const onScroll = () => start();
  const onResize = () => reset();
  const onVisibility = () => {
    if (document.hidden) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      reset();
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    clear();
  };
}
