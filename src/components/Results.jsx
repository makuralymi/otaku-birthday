/* ============================================================
   Results.jsx · 结果区：筛选 / 排序 / 卡片网格
   卡片配色来自该角色立绘的莫奈取色，全部为纯色填充。
   ============================================================ */

import { useEffect, useRef, useState } from 'react';
import { displayName, subName, primaryWork } from '../lib/data.js';
import { cardVars, paletteForCard, quickPalette } from '../lib/palette.js';
import { routeChain, mountImage, loadedRouteOf } from '../lib/images.js';
import { compact } from '../lib/format.js';
import { CLEAN_BUILD } from '../lib/buildflags.js';

/** 单张角色卡：进入视口后取色 + 多线路加载立绘 */
export function CharacterCard({ char, index, isFav, onOpen, onToggleFav, onHover, priority }) {
  // 索引来源的记录（全局搜索）缺少简介/作品明细，点开时由上层跳到当天页面再展开
  const cardRef = useRef(null);
  const imgRef = useRef(null);
  const [palette, setPalette] = useState(() => quickPalette(char));
  const [revealed, setRevealed] = useState(false);

  // 只在进入视口后干活（80 张卡也不会一起触发取色）
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver !== 'function') { setRevealed(true); return undefined; }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setRevealed(true); io.disconnect(); }
    }, { rootMargin: '240px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 多线路挂载图片：直连失败自动降级，换线路成功后重新取色
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return undefined;
    mountImage(img, routeChain(char, { size: 'thumb' }), { char, priority });
    const onLoad = async () => {
      const loaded = loadedRouteOf(img);
      const fresh = await paletteForCard({ ...char, thumb: loaded.url || char.thumb }, img);
      setPalette(fresh);
    };
    img.addEventListener('load', onLoad);
    return () => img.removeEventListener('load', onLoad);
  }, [char, priority]);

  // 真正取色（实时 canvas / 预计算色板 / 哈希兜底）
  useEffect(() => {
    if (!revealed) return undefined;
    let cancelled = false;
    (async () => {
      const img = imgRef.current;
      if (img && !img.complete) {
        try { await img.decode(); } catch { /* 图挂了就用预存色板 */ }
      }
      const paletteNow = await paletteForCard(char, img);
      if (!cancelled) setPalette(paletteNow);
    })();
    return () => { cancelled = true; };
  }, [revealed, char]);

  const nsfw = char.nsfw;
  return (
    <article
      ref={cardRef}
      className="card"
      style={cardVars(palette)}
      role="button"
      tabIndex={0}
      data-id={char.id}
      aria-label={displayName(char)}
      onMouseEnter={() => onHover?.(char, palette)}
      onFocus={() => onHover?.(char, palette)}
      onClick={() => onOpen(index)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(index); }
      }}
    >
      <div className="card-art">
        {char.ptype ? <span className="card-badge">{char.ptype}</span> : null}
        {nsfw ? <span className="card-badge r18">R18</span> : null}
        <img ref={imgRef} alt={`${displayName(char)} 立绘`} loading="lazy" decoding="async" />
        <button
          className={`card-fav${isFav ? ' on' : ''}`}
          type="button"
          aria-label={isFav ? '取消收藏' : '收藏'}
          title={isFav ? '取消收藏' : '收藏'}
          onClick={(e) => { e.stopPropagation(); onToggleFav(char); }}
        >
          {isFav ? '★' : '☆'}
        </button>
      </div>
      <div className="card-body">
        <div className="card-name">
          {displayName(char)}
          {subName(char) ? <span>{subName(char)}</span> : null}
        </div>
        <div className="card-work" title={primaryWork(char)}>{primaryWork(char)}</div>
        <div className="card-tags">
          {char.types.slice(0, 2).map((t) => <span className="tag" key={t}>{t}</span>)}
          {char.heat ? <span className="tag heat">♥ {compact(char.heat)}</span> : null}
        </div>
      </div>
      <span className="card-bar" aria-hidden="true" />
    </article>
  );
}

const SORTS = [
  ['heat', '按人气'],
  ['work_year', '按作品年份（新→旧）'],
  ['work_year_asc', '按作品年份（旧→新）'],
  ['name', '按名字'],
  ['type', '按作品类型'],
];

export default function Results({
  mode, month, day, rows, totalOfDay, baseRows, filtered, filters, meta,
  loading, onFilterChange, onOpen, onOpenFromSearch, onToggleFav, favIds, onHover,
  onExport, onShare, onGlobalSearch, onReset, onRandom, onNear,
}) {
  const [globalLoading, setGlobalLoading] = useState(0);
  const typeCount = {};
  baseRows.forEach((r) => r.types.forEach((t) => { typeCount[t] = (typeCount[t] || 0) + 1; }));
  const types = ['动画', '漫画', '轻小说', '游戏', 'Galgame', '其他'].filter((t) => typeCount[t]);
  const isGlobal = mode === 'search';

  return (
    <section className="results" id="results">
      <div className="section-head">
        <div>
          <h2 className="section-title" id="date-label">
            {isGlobal ? '搜索结果' : `${month} 月 ${day} 日`}
            <em>出生的角色</em>
          </h2>
          <p className="section-sub" id="result-sub">
            {isGlobal
              ? <>在全部 <b>{(meta?.total || 0).toLocaleString('zh-CN')}</b> 位角色中找到 <b>{filtered.length}</b> 位 · 点击跳转到 TA 的生日页面</>
              : totalOfDay
                ? <>这一天共有 <b>{totalOfDay}</b> 位角色 · 悬停卡片让页面主色换成 TA 的颜色 · 快捷键 ← → 切换日期</>
                : '这一天暂时没有收录到的角色'}
          </p>
        </div>
        <div className="section-tools">
          <input
            type="search"
            id="q"
            value={filters.q}
            placeholder="筛选名字 / 作品 / 简介…"
            aria-label="结果内搜索"
            onChange={(e) => onFilterChange({ q: e.target.value })}
          />
          <select id="sort" value={filters.sort} aria-label="排序方式" onChange={(e) => onFilterChange({ sort: e.target.value })}>
            {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <button className="btn small" id="btn-export" type="button" onClick={onExport}>导出 CSV</button>
          {CLEAN_BUILD ? null : (
            <button className="btn small" id="btn-share" type="button" onClick={onShare}>分享</button>
          )}
        </div>
      </div>

      <div className="filterbar">
        <div className="chips" id="type-chips">
          {types.length > 1 && types.map((t) => (
            <button
              key={t}
              className="chip"
              type="button"
              aria-pressed={filters.types.includes(t)}
              onClick={() => onFilterChange({
                types: filters.types.includes(t) ? filters.types.filter((x) => x !== t) : [...filters.types, t],
              })}
            >
              {t}<b>{typeCount[t]}</b>
            </button>
          ))}
        </div>
        <label className="switch">
          <input
            id="nsfw"
            type="checkbox"
            checked={filters.nsfw}
            onChange={(e) => onFilterChange({ nsfw: e.target.checked })}
          />
          <span>包含 R18 / NSFW</span>
        </label>
      </div>

      {loading ? (
        <div className="grid-skeleton" id="skeleton">
          {Array.from({ length: 10 }, (_, i) => <div className="sk-card" key={i} />)}
        </div>
      ) : filtered.length ? (
        <div className="grid" id="grid" onMouseLeave={() => onHover(null)}>
          {filtered.map((c, i) => (
            <CharacterCard
              key={c.id}
              char={c}
              index={i}
              isFav={favIds.has(c.id)}
              onOpen={isGlobal ? (() => onOpenFromSearch?.(c)) : onOpen}
              onToggleFav={onToggleFav}
              onHover={onHover}
              priority={i < 6}
            />
          ))}
        </div>
      ) : (
        <div className="empty" id="empty">
          {!isGlobal && totalOfDay === 0 ? (
            <>
              {month} 月 {day} 日还没有收录角色。可以试试
              <button className="linkish" type="button" onClick={onNear}>相邻日期</button>，或
              <button className="linkish" type="button" onClick={onRandom}>随机一天</button>。
            </>
          ) : filters.q && !isGlobal ? (
            <>
              当天结果里没有匹配「<b>{filters.q}</b>」的角色。
              <button
                className="linkish"
                type="button"
                onClick={async () => { await onGlobalSearch(setGlobalLoading); }}
              >
                {globalLoading ? `正在载入全年数据… ${Math.round(globalLoading * 100)}%` : '在全年数据中搜索'}
              </button>
            </>
          ) : (
            <>
              没有符合当前筛选条件的角色。
              <button className="linkish" type="button" onClick={onReset}>清除筛选</button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
