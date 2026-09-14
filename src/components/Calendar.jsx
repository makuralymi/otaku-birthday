/* ============================================================
   Calendar.jsx · 全年生日分布（纯色块热力图）
   色阶由当前页面主色与底色混合出的 5 级实色，不使用 CSS 渐变。
   ============================================================ */

import { useMemo } from 'react';
import { daysInMonth } from '../lib/data.js';
import { mixHex } from '../lib/palette.js';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

export default function Calendar({ meta, month, day, palette, onPick }) {
  const levels = useMemo(() => {
    const surface = palette?.surface || '#f1efea';
    const accent = palette?.accent || '#4d6b8a';
    return [0, 0.22, 0.44, 0.68, 1].map((t) => mixHex(surface, accent, t));
  }, [palette]);

  if (!meta) return null;
  const max = Math.max(1, meta.max_day || 1);
  const today = new Date();

  return (
    <section className="calendar-section" id="calendar">
      <div className="section-head">
        <div>
          <h2 className="section-title">全年生日分布</h2>
          <p className="section-sub">色块越深，当天出生的角色越多。点击任意日期即可查询。</p>
        </div>
        <div className="legend">
          <span>少</span>
          {levels.map((hex, i) => <i key={i} style={{ background: hex }} />)}
          <span>多</span>
        </div>
      </div>
      <div className="months" id="cal-grid">
        {(meta.days || []).map((counts, mi) => {
          const m = mi + 1;
          const dim = daysInMonth(m);
          return (
            <div className="month" key={m}>
              <h3>{m} 月<b>{meta.months?.[mi] ?? 0} 人</b></h3>
              <div className="days">
                {WEEK.map((w) => <i className="week" key={w}>{w}</i>)}
                {Array.from({ length: dim }, (_, i) => i + 1).map((d) => {
                  const n = counts[d] || 0;
                  const step = n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / max) * 3.4));
                  const isToday = m === today.getMonth() + 1 && d === today.getDate();
                  const active = m === month && d === day;
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`day${active ? ' active' : ''}${isToday ? ' today' : ''}${n === 0 ? ' empty-day' : ''}`}
                      style={{ background: active ? (palette?.accent || '#4d6b8a') : levels[step], color: step >= 3 || active ? '#fff' : 'var(--ink-2)' }}
                      title={`${m}月${d}日 · ${n} 位角色`}
                      onClick={() => onPick(m, d)}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
