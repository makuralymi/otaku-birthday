/* ============================================================
   lenisScroll.js · 平滑滚动（Lenis，与参考项目同一套做法）
   ------------------------------------------------------------
   参考：/mnt/data/project/Ameath/Fleet-Snowfluff-Web/src/main.js
        new Lenis({ duration: 1.2, easing: t => 1 - (1-t)^3,
                    smoothWheel: true, smoothTouch: false })
        + 自己 requestAnimationFrame 驱动 lenis.raf(time)

   为什么不再手写：之前自己实现的「逐帧改 scrollTo + .page transform」那套，
   在站点 CSS 的 html{scroll-behavior:smooth} 下会和浏览器的滚动动画互相打架，
   表现为「一闪一闪、跳来跳去」。Lenis 是成熟实现：
     · 每次输入转成 duration + easing 的滚动动画（不是逐帧 lerp 追位置，不抖）
     · 逐帧 scrollTo({behavior:'instant'})，并配合 CSS 把 scroll-behavior 关掉
     · data-lenis-prevent 的内部滚动区直接放行（抽屉、任何内部滚动条）
     · 键盘 / 滚动条 / 锚点 / 原生滚动事件都会自动同步

   这里额外保留需求里的「只在顶部/底部回弹」：越界输入变成 .page 的橡皮筋位移，
   松手用欠阻尼弹簧弹回；中部全程不碰 transform，所以不会闪。
   ============================================================ */
import Lenis from 'lenis';

/* 与参考项目一致的参数（含最小必要补充） */
export const SMOOTH_OPTIONS = {
  duration: 1.2,                                  // 一格输入的滑行时长
  easing: (t) => 1 - (1 - t) ** 3,                // easeOutCubic
  smoothWheel: true,
  smoothTouch: false,                             // 触摸设备保持原生
  wheelMultiplier: 1,
  touchMultiplier: 1,
  anchors: true,                                  // 锚点跳转也走平滑
  autoRaf: false,                                 // 我们自己驱动 raf
  autoResize: true,
  overscroll: true,
};

/* 边缘橡皮筋（只有到顶/到底才出现）
   ------------------------------------------------------------
   要点：必须和 Lenis 用同一套「滚轮增量归一化」，否则不同浏览器/设备
   手感差一个量级（Firefox 一格是 deltaMode=1 / deltaY=3，原始值直接乘
   系数的话一格只能拉动 1~2px，等于没有）。
   Lenis 内部：LINE_HEIGHT = 100/6 ≈ 16.67px，deltaMode=1 乘它，=2 乘视口高度。 */
const LINE_HEIGHT = 100 / 6;

const BOUNCE = {
  max: 170,        // 最多拉扯多少 px（渐进阻尼，越拉越紧）
  resist: 0.32,    // 第一格的拉扯比例
  omega: 11,       // 回弹角频率：比 Lenis 的 1.2s 滑行更慢一点，观感才连贯
  zeta: 0.5,       // 阻尼比 <1 → 松手弹一下
  releaseMs: 120,  // 最后一次滚轮之后多久开始回弹
  activePx: 0.5,   // 小于它就归零（滞回，避免逐帧加删 transform 造成闪烁）
};

function createEdgeBounce(getWrapper, tune = {}) {
  const cfg = { ...BOUNCE, ...tune };
  const node = () => (typeof getWrapper === 'function' ? getWrapper() : getWrapper);
  const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const insidePrevented = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      if (n.hasAttribute?.('data-lenis-prevent') || n.hasAttribute?.('data-native-scroll')) return true;
      n = n.parentElement;
    }
    return false;
  };
  // 与 Lenis 完全一致的归一化
  const normDelta = (e) => {
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= LINE_HEIGHT;
    else if (e.deltaMode === 2) d *= window.innerHeight;
    return d;
  };

  let rubber = 0;
  let vel = 0;
  let raf = 0;
  let timer = 0;
  let tPrev = 0;
  let releasing = true;
  let painted = false;

  const paint = () => {
    const el = node();
    if (!el) return;
    const active = Math.abs(rubber) > cfg.activePx;
    if (active) {
      el.style.willChange = 'transform';
      el.style.transform = `translate3d(0, ${(-rubber).toFixed(2)}px, 0)`;
      painted = true;
    } else if (painted) {
      el.style.transform = '';
      el.style.willChange = '';
      painted = false;
    }
  };

  const step = (now) => {
    const dt = Math.min(1 / 30, Math.max(1 / 240, ((now - tPrev) / 1000) || 1 / 60));
    tPrev = now;
    if (releasing) {
      const h = dt / 2;
      for (let i = 0; i < 2; i += 1) {
        const a = -cfg.omega * cfg.omega * rubber - 2 * cfg.zeta * cfg.omega * vel;
        vel += a * h;
        rubber += vel * h;
      }
      if (Math.abs(rubber) < 0.15 && Math.abs(vel) < 0.6) { rubber = 0; vel = 0; }
    }
    paint();
    if (releasing && rubber === 0) { raf = 0; return; }
    raf = requestAnimationFrame(step);
  };

  const start = () => {
    if (raf) return;
    tPrev = performance.now();
    raf = requestAnimationFrame(step);
  };

  const onWheel = (e) => {
    if (e.ctrlKey || e.metaKey || !e.deltaY) return;
    if (insidePrevented(e.target)) return;                    // 内部滚动区不参与
    const y = window.scrollY;
    const max = maxScroll();
    const delta = normDelta(e);
    const pushingUp = delta < 0 && y <= 0.5;                  // 顶部继续上滚
    const pushingDown = delta > 0 && y >= max - 0.5;          // 底部继续下滚
    if (!pushingUp && !pushingDown) {
      if (!releasing && Math.abs(rubber) <= cfg.activePx) releasing = true;
      return;
    }
    releasing = false;
    // 渐进阻尼：拉得越远，同样一格能拉动的越少（iOS 橡皮筋的手感）
    const room = 1 - Math.min(1, Math.abs(rubber) / cfg.max);
    rubber = clamp(rubber + delta * cfg.resist * room, -cfg.max, cfg.max);
    paint();
    start();
    clearTimeout(timer);
    timer = setTimeout(() => { releasing = true; start(); }, cfg.releaseMs);
  };

  window.addEventListener('wheel', onWheel, { passive: true });

  return () => {
    clearTimeout(timer);
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('wheel', onWheel);
    const el = node();
    if (el) { el.style.transform = ''; el.style.willChange = ''; }
  };
}

export function enableSmoothScroll(getWrapper, tune = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const mq = (q) => (typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false);
  if (mq('(prefers-reduced-motion: reduce)')) return () => {};
  const touchPrimary = mq('(pointer: coarse)')
    && ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);
  if (touchPrimary) return () => {};
  // Lenis 内部直接 new ResizeObserver(...)（没有存在性判断），
  // 老环境/无头测试环境里会直接抛错并让整个应用挂载失败 —— 这里先挡掉，保持原生滚动
  // Lenis 初始化时会无保护地调用 window.matchMedia / new ResizeObserver，
  // 老环境与无头测试环境缺这两个 API 会直接抛错（曾导致整站白屏），这里先挡掉
  if (typeof window.matchMedia !== 'function') {
    window.__lenisSkip = 'no-matchMedia';
    return () => {};
  }
  if (typeof window.ResizeObserver !== 'function') {
    window.__lenisSkip = 'no-ResizeObserver';
    return () => {};
  }

  let lenis = null;
  try {
    lenis = new Lenis({ ...SMOOTH_OPTIONS, ...tune });
  } catch (err) {
    window.__lenisSkip = `init-error: ${err && err.message}`;   // 排障出口
    return () => {};   // 初始化失败也不影响站点：退回原生滚动
  }
  const bounce = createEdgeBounce(getWrapper);

  let raf = 0;
  const loop = (time) => {
    try {
      lenis.raf(time);
    } catch (err) {
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  // 排障/探针出口
  if (typeof window !== 'undefined') window.__lenis = lenis;

  return () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    bounce();
    lenis.destroy();
    if (window.__lenis === lenis) window.__lenis = null;
  };
}
