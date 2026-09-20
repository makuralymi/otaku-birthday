/* ============================================================
   Hero.jsx · 首屏：标题 + 生日选择器 + 色块带 + 人气预览
   全部使用纯色块：没有任何渐变、模糊或半透明叠加。
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { daysInMonth, monthName } from '../lib/data.js';
import { flatPalette, parsePalette, hashColors } from '../lib/palette.js';
import { placeholderURI } from '../lib/images.js';
import { LOCAL_IMAGES_ONLY } from '../lib/buildflags.js';

/** 色板条：5 个纯色方块，跟随当前角色/当天主色 */
export function PaletteBlocks({ palette, height = 10, className = '' }) {
  const colors = palette?.blocks || ['#c9d3e0', '#b9c6d8', '#a9b8cf', '#d8dfe8', '#e6e9ef'];
  return (
    <div className={`palette-blocks ${className}`} style={{ height }} aria-hidden="true">
      {colors.map((hex, i) => (
        // --i 供 CSS 做「依次浮现」的延迟（间隔 70ms），抽屉等其他场景不受影响
        <span key={i} style={{ background: hex, '--i': i }} />
      ))}
    </div>
  );
}

/** 月/日选择器：每个日期后面直接带当天角色数 */
function Picker({ meta, month, day, onChange, onToday, onRandom }) {
  const monthRef = useRef(null);
  const dayRef = useRef(null);
  // 去重：React 的 onChange 与下面的原生 change 监听可能都会触发，同一天只应用一次
  const lastApplied = useRef(`${month}-${day}`);

  // 外部改日期（日历 / URL / 今天 / 随机 / 上一个选择器）时，把 DOM 与去重标记同步过来
  useEffect(() => {
    lastApplied.current = `${month}-${day}`;
    if (monthRef.current) monthRef.current.value = String(month);
    if (dayRef.current) dayRef.current.value = String(Math.min(day, daysInMonth(month)));
  }, [month, day]);

  const apply = useCallback((mm, dd) => {
    const m2 = Math.min(12, Math.max(1, Number(mm) || 1));
    const d2 = Math.min(daysInMonth(m2), Math.max(1, Number(dd) || 1));
    const key = `${m2}-${d2}`;
    if (lastApplied.current === key) return;   // 已经在这个日期上了
    lastApplied.current = key;
    onChange(m2, d2);
  }, [onChange]);

  // 原生 change 兜底：不依赖 React 的合成事件，任何触发路径都能生效（apply 幂等）
  useEffect(() => {
    const ms = monthRef.current;
    const ds = dayRef.current;
    if (!ms || !ds) return undefined;
    const onMonth = () => apply(+ms.value, +ds.value || 1);
    const onDay = () => apply(+ms.value, +ds.value);
    ms.addEventListener('change', onMonth);
    ds.addEventListener('change', onDay);
    return () => {
      ms.removeEventListener('change', onMonth);
      ds.removeEventListener('change', onDay);
    };
  }, [apply]);

  const counts = meta?.days?.[month - 1] || [];

  return (
    <form
      className="picker"
      onSubmit={(e) => {
        e.preventDefault();
        apply(month, day);
        onChange?.(month, day);
      }}
    >
      <div className="picker-row">
        <label className="field">
          <span className="field-label">月</span>
          <select
            id="sel-month"
            ref={monthRef}
            value={month}
            onChange={(e) => apply(+e.target.value, day)}
            aria-label="出生月份"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => (
              <option key={mm} value={mm}>{`${mm} 月 · ${meta?.months?.[mm - 1] ?? 0} 人`}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">日</span>
          <select
            id="sel-day"
            ref={dayRef}
            value={Math.min(day, daysInMonth(month))}
            onChange={(e) => apply(month, +e.target.value)}
            aria-label="出生日期"
          >
            {Array.from({ length: daysInMonth(month) }, (_, i) => i + 1).map((dd) => (
              <option key={dd} value={dd}>{`${dd} 日 · ${counts[dd] ?? 0} 位角色`}</option>
            ))}
          </select>
        </label>
        <button className="btn primary" id="btn-go" type="submit">查看同生日的角色</button>
      </div>
      <div className="picker-row minor">
        <button className="btn ghost" id="btn-today" type="button" onClick={onToday}>
          今天 · {new Date().getMonth() + 1}月{new Date().getDate()}日
        </button>
        <button className="btn ghost" id="btn-random" type="button" onClick={onRandom}>随机一天</button>
        <span className="picker-hint">
          共 <b id="stat-total">{meta?.total?.toLocaleString('zh-CN') ?? '—'}</b> 位角色 · 数据更新于 <b id="stat-date">{meta?.generated_at?.slice(0, 10) ?? '—'}</b>
        </span>
      </div>
    </form>
  );
}

/** 首屏随机预览：从构建期给的候选池里随机抽一批，每次打开都不一样 */
const GALLERY_SIZE = 24;

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** 抽取下一批：尽量避开当前这批，点「换一批」时才有新鲜感 */
function pickBatch(all, exclude = []) {
  const skip = new Set(exclude);
  const rest = all.filter((f) => !skip.has(f.id));
  const pool = rest.length >= GALLERY_SIZE ? rest : all;
  return shuffle(pool).slice(0, GALLERY_SIZE);
}

function Gallery({ featured, onPick }) {
  const all = useMemo(() => (featured || []).map((f) => {
    const colors = parsePalette(f.p);
    return { ...f, palette: flatPalette(colors.length > 1 ? colors : hashColors(f.id), f.id) };
  }), [featured]);

  const [batch, setBatch] = useState([]);
  useEffect(() => { setBatch(pickBatch(all)); }, [all]);

  if (!all.length) return null;
  return (
    <section className="gallery-block" aria-label="随机角色预览">
      <div className="gallery-head">
        <span className="fine">随机看看 · 每次刷新都不一样</span>
        <button
          className="btn small"
          id="btn-gallery-shuffle"
          type="button"
          onClick={() => setBatch((cur) => pickBatch(all, cur.map((c) => c.id)))}
        >
          换一批
        </button>
      </div>
      <div className="gallery" id="gallery">
        {batch.map((f) => (
          <button
            key={f.id}
            className="gallery-item"
            type="button"
            style={{ '--g-surface': f.palette.surface, '--g-line': f.palette.line, '--g-ink': f.palette.ink, '--g-bar': f.palette.blocks[0] }}
            onClick={() => onPick(f.m, f.d)}
            title={`${f.m}/${f.d} ${f.n}${f.ty ? ' · ' + f.ty : ''}`}
          >
            <img
              src={LOCAL_IMAGES_ONLY ? placeholderURI({ id: f.id, palette: f.p, nameCn: f.n }) : f.img}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
            />
            <span className="gallery-bar" />
            <span className="gallery-name">{f.n}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default function Hero({ meta, month, day, palette, onChange, onPickFeatured }) {
  const onToday = () => {
    const now = new Date();
    onChange(now.getMonth() + 1, now.getDate());
  };
  const onRandom = () => {
    const pool = [];
    (meta?.days || []).forEach((counts, mi) => counts.forEach((n, di) => { if (n > 0) pool.push([mi + 1, di]); }));
    if (!pool.length) return;
    const [mm, dd] = pool[Math.floor(Math.random() * pool.length)];
    onChange(mm, dd);
  };

  return (
    <section className="hero">
      <div className="hero-main">
        <p className="hero-eyebrow">{monthName(month)} · {day} 日生诞祭</p>
        <h1 className="hero-title" id="hero-title">
          {/* inline span：开屏动画要按「文字实际边界」对齐，块级元素的矩形是整行宽度，对不准 */}
          <span id="hero-title-text">你的生日里，住着哪些角色？</span>
        </h1>
        <p className="hero-lede">
          <span className="hero-lede-text">
            收录动画、漫画、轻小说、二次元游戏与 GalGame 角色的官方生日设定。选一个月日，看看与你同一天出生的人都是谁。
          </span>
          <span className="hero-lede-tip" style={{ color: palette?.accent || 'var(--m-accent)' }}>
            如有立绘加载失败请切换网络环境后刷新。
          </span>
        </p>
        <Picker meta={meta} month={month} day={day} onChange={onChange} onToday={onToday} onRandom={onRandom} />
      </div>
      <PaletteBlocks palette={palette} height={12} className="hero-blocks" />
      <Gallery featured={meta?.featured} onPick={onPickFeatured} />
    </section>
  );
}
