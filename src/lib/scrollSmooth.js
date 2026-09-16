/* ============================================================
   scrollSmooth.js · 主页面「无级平滑滚动」+ 仅在上下边缘的橡皮筋回弹
   ------------------------------------------------------------
   想要的效果（按需求）：

     ① 主页面滚动要「无级」 —— 滚轮/触控板的每一格输入不是让页面瞬移，
        而是被接过来、平滑成一段连续滑动：从静止起步（初始速度为 0，无突跳）
        → 加速 → 柔和减速贴合，一格约 300ms 滑完；连续几格会自然叠成一段长滑行，
        所以看起来是顺滑的连续滚动，而不是一格一格跳。

        手感由两个数决定：
          · OMEGA 决定「黏度/惯性滑行时长」—— 20 偏柔（一格 ~300ms），35+ 会明显变干脆；
          · 临界阻尼 ζ=1：追平就停，不会冲过头（中部不回弹就靠这个）；
          · MAX_LAG 是高速连滚时的落后上限，避免快速连滚越拖越远。

     ② 平时**不回弹** —— 页面中部的跟随用「临界阻尼」系统（ζ=1，绝不过冲），
        停手就稳稳停在目标位置，不回弹、不晃动、不残留位移。

     ③ 只有**到顶/到底**才回弹 —— 越界的那部分输入变成「橡皮筋」拉扯：
        内容跟手被拉出边界（有阻尼、有上限），松手后再弹回去（欠阻尼 → 弹一下），
        也就是只有在顶部和底部才出现的回弹。

   实现要点：
     · wheel 事件里 preventDefault（自己驱动滚动）——否则浏览器原生滚动会与平滑叠加成双倍；
       但**只要事件发生在任何可滚动祖先里（抽屉 .drawer-panel / .drawer-body、
       带 data-native-scroll 的区域、各类内部滚动条），立即放行**，交还浏览器原生滚动。
     · 键盘 / 滚动条拖动 / 锚点 / scrollIntoView 一律不拦：它们改变 scrollY 后由
       scroll 监听做一次自动同步（不会和我们的动画打架）。
     · 滚动位置用 scrollTo(..., behavior:'instant') 逐帧写；橡皮筋用 .page 的 transform 表现。
     · 触摸为主或开启「减少动效」→ 整段不接管，保持原生滚动。
   ============================================================ */

const OMEGA = 20;          // 跟随角频率（rad/s）：越小越「黏」、惯性滑行越久；20 ≈ 一格滑 300ms
                           // 临界阻尼 ζ=1（见下面的 2ω·vCur）：有惯性、不回弹、不过冲
const MAX_LAG = 150;       // 高速连滚时的滞后上限（px）：超过就把内容往前带，避免越拖越远
const SETTLE_PX = 0.4;     // 与目标差小于该值且速度接近 0 → 贴合、停机
const LINE_PX = 40;        // deltaMode=1（按行）换算：Firefox 一格 = 3 行 → 约 120px，
                           // 与 Chrome 的 ~100px/格 对齐（否则 Firefox 一格只走 48px，更像步进）
const PAGE_RATIO = 0.9;    // deltaMode=2（按页）换算成视口高度比例
const MAX_RUBBER = 132;    // 边缘最多拉扯多少 px
const RUBBER_RESIST = 0.45;// 越界输入的阻尼（越小越硬）
const RUBBER_OMEGA = 17;   // 橡皮筋回弹角频率
const RUBBER_ZETA = 0.42;  // 回弹阻尼比：<1 → 到边缘松手会「弹一下」
const RELEASE_MS = 90;     // 最后一次滚轮之后多久开始回弹
const MAX_DT = 1 / 30;     // 单帧最大步长
const SUBSTEPS = 2;        // 子步（数值稳定）
const SYNC_PX = 2;         // 外部滚动同步阈值

export function enableScrollSmooth(getWrapper, tune = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const mq = (q) => (typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false);
  if (mq('(prefers-reduced-motion: reduce)')) return () => {};
  const touchPrimary = mq('(pointer: coarse)')
    && ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);
  if (touchPrimary) return () => {};

  const cfg = { omega: OMEGA, maxLag: MAX_LAG, maxRubber: MAX_RUBBER, resist: RUBBER_RESIST,
    rubberOmega: RUBBER_OMEGA, rubberZeta: RUBBER_ZETA, releaseMs: RELEASE_MS, ...tune };

  const node = () => (typeof getWrapper === 'function' ? getWrapper() : getWrapper);
  const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  let cur = window.scrollY;     // 当前实际滚动位置（我们逐帧写的）
  let target = cur;             // 平滑目标
  let vCur = 0;                 // 跟随速度（临界阻尼系统的状态）
  let raw = cur;                // 输入累计（未截断，用来算越界量）
  let rubber = 0;               // 边缘拉扯量（>0 底部越界、<0 顶部越界）
  let vRubber = 0;
  let raf = 0;
  let tPrev = 0;
  let releasing = true;         // 是否处于「松手回弹」阶段
  let releaseTimer = 0;

  const paintRubber = () => {
    const el = node();
    if (!el) return;
    if (Math.abs(rubber) < 0.1) {
      if (el.style.transform) { el.style.transform = ''; el.style.willChange = ''; }
      return;
    }
    // rubber>0（底部继续下拉）→ 内容上移，视觉上被「拉出去」
    el.style.willChange = 'transform';
    el.style.transform = `translate3d(0, ${(-rubber).toFixed(2)}px, 0)`;
  };

  const writeScroll = (y) => {
    const opts = { top: y, left: 0, behavior: 'instant' };
    try { window.scrollTo(opts); } catch (err) { window.scrollTo(0, y); }
  };

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const settleTo = (y) => {
    cur = y; target = y; raw = y; vCur = 0;
    rubber = 0; vRubber = 0; releasing = true;
    paintRubber();
  };

  const step = (now) => {
    const dt = Math.min(MAX_DT, Math.max(1 / 240, ((now - tPrev) / 1000) || 1 / 60));
    tPrev = now;

    // ① 平滑跟随（临界阻尼 ζ=1：跟得快、不过冲 → 中部不会回弹）
    const h = dt / SUBSTEPS;
    for (let i = 0; i < SUBSTEPS; i += 1) {
      const a = cfg.omega * cfg.omega * (target - cur) - 2 * cfg.omega * vCur;
      vCur += a * h;
      cur += vCur * h;
    }
    // 滞后上限：单格（≤120px）完全不受影响；快速连滚时最多落后 MAX_LAG，
    // 既保留惯性手感，又不会「输入滚了 3 格、画面还差 2 格」
    const lag = target - cur;
    if (Math.abs(lag) > cfg.maxLag) {
      cur = target - Math.sign(lag) * cfg.maxLag;
      const vCap = cfg.omega * cfg.maxLag;
      if (Math.abs(vCur) > vCap) vCur = Math.sign(vCur) * vCap;
    }
    if (Math.abs(target - cur) > 0.02) writeScroll(cur);
    else cur = target;

    // ② 边缘橡皮筋：只在越界时存在；松手后弹回 0（这里的回弹是唯一允许的回弹）
    if (releasing && Math.abs(rubber) > 0.05) {
      const hr = dt / SUBSTEPS;
      for (let i = 0; i < SUBSTEPS; i += 1) {
        const a = -cfg.rubberOmega * cfg.rubberOmega * rubber - 2 * cfg.rubberZeta * cfg.rubberOmega * vRubber;
        vRubber += a * hr;
        rubber += vRubber * hr;
      }
      if (Math.abs(rubber) < 0.15) { rubber = 0; vRubber = 0; }
    } else if (releasing && rubber !== 0) {
      rubber = 0; vRubber = 0;
    }
    if (releasing) raw = clamp(raw, 0, maxScroll());
    paintRubber();

    // ③ 停机判定：滚动贴合 + 橡皮筋归零
    const movingScroll = Math.abs(target - cur) > SETTLE_PX || Math.abs(vCur) > SETTLE_PX;
    const movingRubber = Math.abs(rubber) > 0.15 || Math.abs(vRubber) > 0.6;
    if (!movingScroll && !movingRubber) {
      cur = target;
      if (Math.abs(window.scrollY - cur) > 0.5) writeScroll(cur);
      settleTo(cur);
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(step);
  };

  const start = () => {
    if (raf) return;
    tPrev = performance.now();
    raf = requestAnimationFrame(step);
  };

  /** 事件是否发生在「内部可滚动区域」里：是的话完全不接管，交还浏览器 */
  const insideScrollable = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      if (n.hasAttribute?.('data-native-scroll')) return true;
      const st = window.getComputedStyle(n);
      const scrollable = /(auto|scroll|overlay)/.test(st.overflowY);
      if (scrollable && n.scrollHeight - n.clientHeight > 1) return true;
      n = n.parentElement;
    }
    return false;
  };

  const onWheel = (e) => {
    if (e.ctrlKey || e.metaKey || e.defaultPrevented) return;   // 缩放等手势不拦
    if (insideScrollable(e.target)) return;                     // 抽屉等内部滚动：原生
    let delta = e.deltaY;
    if (!delta) return;
    if (e.deltaMode === 1) delta *= LINE_PX;
    else if (e.deltaMode === 2) delta *= window.innerHeight * PAGE_RATIO;

    e.preventDefault();   // 交由我们平滑驱动（否则会与原生滚动叠加成双倍）
    releasing = false;
    vRubber = 0;
    if (Math.abs(window.scrollY - cur) > SYNC_PX) { cur = window.scrollY; target = window.scrollY; }
    const max = maxScroll();
    raw = clamp(raw, -cfg.maxRubber * 4, max + cfg.maxRubber * 4);
    raw += delta;
    target = clamp(raw, 0, max);
    const beyond = raw - target;                                // >0 底部越界 / <0 顶部越界
    rubber = clamp(beyond * cfg.resist, -cfg.maxRubber, cfg.maxRubber);
    start();

    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => { releasing = true; start(); }, cfg.releaseMs);
  };

  // 外部滚动（键盘 / 滚动条 / 锚点 / scrollIntoView / 浏览器前进后退）→ 自动同步，不打架
  const onScroll = () => {
    if (Math.abs(window.scrollY - cur) <= SYNC_PX) return;
    stop();
    settleTo(window.scrollY);
  };

  const onResize = () => { stop(); settleTo(window.scrollY); };
  const onVisibility = () => { if (document.hidden) { stop(); settleTo(window.scrollY); } };

  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    clearTimeout(releaseTimer);
    stop();
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    const el = node();
    if (el) { el.style.transform = ''; el.style.willChange = ''; }
  };
}
