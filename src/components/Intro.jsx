/* ============================================================
   Intro.jsx · 开屏动画
   流程：居中浮出「日期 + 站点标题」→ 停留 1 秒 → 上移落到主页面里
   标题所在的位置 → 其余内容依次渐显。
   全程只用 transform/opacity（纯色，无渐变），尊重 prefers-reduced-motion。
   ============================================================ */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const HOLD_MS = 1000;     // 停留时间（需求：1 秒）
const RISE_MS = 620;      // 浮出
const MOVE_MS = 700;      // 上移归位

export const INTRO_DONE_CLASS = 'page-ready';

export default function Intro({ month, day, onDone }) {
  const [phase, setPhase] = useState('init');   // init → rise → hold → move → gone
  const [ready, setReady] = useState(false);
  const boxRef = useRef(null);
  const itemRef = useRef(null);
  const reduce = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  // 时间线：浮出 → 停留 1s → 上移归位 → 移除
  useEffect(() => {
    if (reduce) {
      document.body.classList.add(INTRO_DONE_CLASS);
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
        setPhase('gone');
        document.body.classList.remove('intro-lock', 'intro-pending');
        document.body.classList.add(INTRO_DONE_CLASS);
        onDone?.();
      }, 30 + RISE_MS + HOLD_MS + MOVE_MS),
    ];
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  // 上移阶段：把开屏内容平移到主页面标题所在位置（用 transform，零布局抖动）
  useLayoutEffect(() => {
    if (phase !== 'move') return;
    const item = itemRef.current;
    const heroTitle = document.getElementById('hero-title');
    if (!item || !heroTitle) { setReady(true); return; }
    const from = item.getBoundingClientRect();
    const to = heroTitle.getBoundingClientRect();
    const scale = Math.max(0.35, Math.min(1.6, to.width / Math.max(1, from.width)));
    item.style.setProperty('--intro-dx', `${to.left - from.left}px`);
    item.style.setProperty('--intro-dy', `${to.top - from.top}px`);
    item.style.setProperty('--intro-scale', String(scale));
    item.style.setProperty('--intro-ms', `${MOVE_MS}ms`);
    setReady(true);                                  // 触发 CSS 里的入场/归位过渡
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === 'gone') return null;

  return (
    <div className={`intro intro-${phase}${ready ? ' intro-go' : ''}`} id="intro" aria-hidden="true">
      <div className="intro-box" ref={boxRef}>
        <div className="intro-item" ref={itemRef}>
          <p className="intro-date" id="intro-date">{month} 月 {day} 日</p>
          <h1 className="intro-title">你的生日里，住着哪些角色？</h1>
          <span className="intro-bar" />
        </div>
      </div>
    </div>
  );
}
