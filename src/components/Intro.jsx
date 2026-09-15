/* ============================================================
   Intro.jsx · 开屏动画
   流程：居中浮出「日期 + 站点标题」→ 停留 1 秒 → 上移并缩放，
   **按文字实际边界**精确落到主页面标题的位置 → 开屏背景层渐隐、标题硬切换 → 其余内容依次渐显。

   标题文字全程 opacity:1，**不参与任何淡入淡出**：
   位置对齐后，开屏图层移除与主页面标题点亮发生在同一帧，视觉上文字一直在那儿。

   对齐做法：两边都把标题文字包在 inline span 里量 rect（inline 元素的矩形就是文字边界），
   再用 transform-origin: top left + translate + scale 把开屏文字映射到主页面文字上，
   所以交接瞬间两段文字重合，不会「跳一下」。
   ============================================================ */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const RISE_MS = 600;     // 浮出
const HOLD_MS = 1000;    // 停留（需求：1 秒）
const MOVE_MS = 700;     // 上移归位
const FADE_MS = 240;     // 与主页面交叉淡入

export const INTRO_DONE_CLASS = 'page-ready';
// 交接那一刻才加：主页面标题此刻**瞬时**显示（不做淡入），与开屏文字像素级重合后完成交换
export const INTRO_HANDOFF_CLASS = 'intro-handoff';

export default function Intro({ month, day, onDone }) {
  const [phase, setPhase] = useState('init');   // init → rise → hold → move → fade → gone
  const [ready, setReady] = useState(false);
  const itemRef = useRef(null);
  const titleRef = useRef(null);
  const reduce = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  useEffect(() => {
    if (reduce) {
      document.body.classList.add(INTRO_DONE_CLASS, INTRO_HANDOFF_CLASS);
      onDone?.();
      setPhase('gone');
      return undefined;
    }
    // 只有 JS 真的接管了才隐藏主内容：脚本若异常，页面照常可见（不会白屏）
    document.body.classList.add('intro-lock', 'intro-pending');
    const timers = [
      setTimeout(() => setPhase('rise'), 30),
      setTimeout(() => setPhase('hold'), 30 + RISE_MS),
      setTimeout(() => setPhase('move'), 30 + RISE_MS + HOLD_MS),
      setTimeout(() => {
        // 进入交叉淡入：主页面标题此刻与开屏文字重合，同时淡入最自然
        setPhase('fade');
        document.body.classList.remove('intro-lock', 'intro-pending');
        document.body.classList.add(INTRO_DONE_CLASS);
        onDone?.();
      }, 30 + RISE_MS + HOLD_MS + MOVE_MS),
      setTimeout(() => {
        // 开屏图层移除的同一帧把主页面标题点亮：两段文字位置/字号完全一致，
        // 所以这一步是「无缝硬切换」，中间不存在任何淡入淡出
        document.body.classList.add(INTRO_HANDOFF_CLASS);
        setPhase('gone');
      }, 30 + RISE_MS + HOLD_MS + MOVE_MS + FADE_MS),
    ];
    return () => {
      timers.forEach(clearTimeout);
      // 兜底：万一中途异常，别让页面卡在「锁定滚动 / 内容不显示」的状态
      document.body.classList.remove('intro-lock', 'intro-pending');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  // 归位：把开屏标题文字精确映射到主页面标题文字上（transform-origin: top left）
  useLayoutEffect(() => {
    if (phase !== 'move') return;
    const from = titleRef.current?.getBoundingClientRect();
    const targetEl = document.getElementById('hero-title-text') || document.getElementById('hero-title');
    const to = targetEl?.getBoundingClientRect();
    const item = itemRef.current;
    if (!from || !to || !item || !from.width || !from.height) { setReady(true); return; }

    // 缩放按「文字宽度比」算：同一串字、同一字体，宽度比才等于字号比。
    // （不能按高度比：开屏文字的行高来自 body 的 1.65，hero 标题是 1.18，高度比会算错）
    const scale = Math.max(0.4, Math.min(1.6, to.width / from.width));
    // 水平：左边缘对齐；垂直：让两段文字的**中心线**重合（行高差异被半行距对称吸收）
    const dx = to.left - from.left;
    const dy = (to.top + to.height / 2) - (from.top + (from.height * scale) / 2);
    item.style.setProperty('--intro-dx', `${dx}px`);
    item.style.setProperty('--intro-dy', `${dy}px`);
    item.style.setProperty('--intro-scale', String(scale));
    item.style.setProperty('--intro-ms', `${MOVE_MS}ms`);
    // 排障出口：把测量值暴露出来（自测脚本/人工排查都能用）
    if (typeof window !== 'undefined') {
      window.__introMetrics = {
        from: { w: from.width, h: from.height, l: from.left, t: from.top },
        to: { w: to.width, h: to.height, l: to.left, t: to.top },
        scale, dx, dy,
        fromFont: window.getComputedStyle(titleRef.current).fontSize,
        toFont: window.getComputedStyle(targetEl).fontSize,
      };
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === 'gone') return null;

  return (
    <div className={`intro intro-${phase}${ready ? ' intro-go' : ''}`} id="intro" aria-hidden="true">
      {/* 只有这一层负责渐隐：页面其余内容随它浮现；标题文字在它之上，永不淡 */}
      <div className="intro-bg" />
      <div className="intro-box">
        <div className="intro-item" ref={itemRef}>
          <p className="intro-date" id="intro-date">{month} 月 {day} 日</p>
          <h1 className="intro-title">
            <span className="intro-title-text" ref={titleRef}>你的生日里，住着哪些角色？</span>
          </h1>
          <span className="intro-bar" />
        </div>
      </div>
    </div>
  );
}
