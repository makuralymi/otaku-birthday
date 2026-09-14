/* ============================================================
   App.jsx · 状态与编排
   数据：meta + 按月分片 CSV（多线路兜底）
   视图：首屏 → 结果网格 → 详情抽屉 → 全年热力图 → 收藏
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadMeta, loadMonth, loadAll, displayName, daysInMonth,
} from './lib/data.js';
import { applyGlobalPalette, quickPalette, cachedCardPalette, rememberCardPalette } from './lib/palette.js';
import { routeChain, mountImage, loadedRouteOf } from './lib/images.js';
import { toCSV, download } from './lib/csv.js';
import { EXPORT_COLUMNS, toExportRow, exportName, shareText } from './lib/format.js';
import Hero, { PaletteBlocks } from './components/Hero.jsx';
import Results from './components/Results.jsx';
import Calendar from './components/Calendar.jsx';
import { DetailDrawer, FavoritesDrawer } from './components/Drawers.jsx';
import { TopBar, About, Footer, Toast } from './components/Layout.jsx';

const FAV_KEY = 'spj:favorites:v1';

const readParams = () => {
  const p = new URLSearchParams(location.search);
  const now = new Date();
  const m = Number(p.get('m'));
  const d = Number(p.get('d'));
  return {
    month: Number.isFinite(m) && m >= 1 && m <= 12 ? m : now.getMonth() + 1,
    day: Number.isFinite(d) && d >= 1 && d <= 31 ? d : now.getDate(),
    char: p.get('c') || '',
    mode: p.get('mode') === 'search' ? 'search' : 'day',
  };
};

export default function App() {
  const initial = useRef(readParams());
  const [meta, setMeta] = useState(null);
  const [month, setMonth] = useState(initial.current.month);
  const [day, setDay] = useState(initial.current.day);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState(initial.current.mode);
  const [allRows, setAllRows] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('heat');
  const [types, setTypes] = useState([]);
  const [nsfw, setNsfw] = useState(false);
  const [selected, setSelected] = useState(-1);
  const [favs, setFavs] = useState([]);
  const [favOpen, setFavOpen] = useState(false);
  const [pagePalette, setPagePalette] = useState(null);
  const [toast, setToast] = useState('');
  const listPaletteRef = useRef(null);
  const toastTimer = useRef(null);

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }, []);

  /* ── 收藏 ─────────────────────────────────────────── */
  useEffect(() => {
    try { setFavs(JSON.parse(localStorage.getItem(FAV_KEY) || '[]') || []); } catch { setFavs([]); }
  }, []);

  const persistFavs = useCallback((next) => {
    setFavs(next);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(next.slice(-300))); } catch { /* 忽略 */ }
  }, []);

  const favIds = useMemo(() => new Set(favs.map((f) => f.id)), [favs]);

  const toggleFav = useCallback((char) => {
    const has = favs.some((f) => f.id === char.id);
    persistFavs(has ? favs.filter((f) => f.id !== char.id) : [...favs, char]);
    notify(has ? `已取消收藏「${displayName(char)}」` : `已收藏「${displayName(char)}」`);
  }, [favs, persistFavs, notify]);

  /* ── 日期切换 ─────────────────────────────────────── */
  const selectDate = useCallback(async (m, d, { push = true, noScroll = false, silent = false } = {}) => {
    const mm = Math.min(12, Math.max(1, m));
    const dd = Math.min(daysInMonth(mm), Math.max(1, d));
    setMode('day');
    setAllRows(null);
    setMonth(mm);
    setDay(dd);
    setSelected(-1);
    setLoading(true);
    try {
      const monthRows = await loadMonth(mm);
      setRows(monthRows.filter((r) => r.day === dd));
    } catch (err) {
      setRows([]);
      if (!silent) notify(err.message);
    }
    setLoading(false);
    const url = new URL(location.href);
    url.searchParams.set('m', String(mm));
    url.searchParams.set('d', String(dd));
    url.searchParams.delete('c');
    url.searchParams.delete('mode');
    history[push ? 'pushState' : 'replaceState']({}, '', url);
    if (!noScroll) {
      requestAnimationFrame(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }, [notify]);

  /* ── 首屏加载 ─────────────────────────────────────── */
  useEffect(() => {
    loadMeta()
      .then((m) => {
        setMeta(m);
        const m0 = initial.current.month;
        const d0 = Math.min(initial.current.day, daysInMonth(m0));
        return selectDate(m0, d0, { push: false, noScroll: true, silent: true });
      })
      .catch((err) => {
        setLoading(false);
        notify(`数据加载失败：${err.message}`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── 页面主色：跟随悬停 / 选中的角色 ───────────────── */
  useEffect(() => {
    const base = rows.length ? quickPalette(rows[0]) : null;
    listPaletteRef.current = base;
    if (base) setPagePalette(base);
  }, [rows]);

  useEffect(() => {
    if (pagePalette) applyGlobalPalette(pagePalette);
  }, [pagePalette]);

  const onHover = useCallback((char, palette) => {
    if (!char) {
      if (listPaletteRef.current) setPagePalette(listPaletteRef.current);
      return;
    }
    setPagePalette(palette || cachedCardPalette(char.id) || quickPalette(char));
  }, []);

  /* ── 过滤 + 排序 ──────────────────────────────────── */
  const baseRows = mode === 'search' && allRows ? allRows : rows;

  const filtered = useMemo(() => {
    let list = baseRows.slice();
    if (types.length) list = list.filter((r) => r.types.some((t) => types.includes(t)));
    if (!nsfw) list = list.filter((r) => !r.nsfw);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => [r.nameCn, r.nameNative, r.nameRomaji, r.altNames, r.work, r.workCn, r.summary]
        .join(' ').toLowerCase().includes(q));
    }
    const sorters = {
      heat: (a, b) => b.heat - a.heat || a.nameRomaji.localeCompare(b.nameRomaji),
      work_year: (a, b) => (+b.workYear || 0) - (+a.workYear || 0) || b.heat - a.heat,
      work_year_asc: (a, b) => (+a.workYear || 9999) - (+b.workYear || 9999) || b.heat - a.heat,
      name: (a, b) => displayName(a).localeCompare(displayName(b), 'zh-Hans-CN'),
      type: (a, b) => a.ptype.localeCompare(b.ptype, 'zh-Hans-CN') || b.heat - a.heat,
    };
    return list.sort(sorters[sort] || sorters.heat);
  }, [baseRows, types, nsfw, query, sort]);

  /* ── 抽屉 ─────────────────────────────────────────── */
  const openDrawer = useCallback((index) => {
    if (index < 0 || index >= filtered.length) return;
    setSelected(index);
    const url = new URL(location.href);
    url.searchParams.set('c', filtered[index].id);
    history.replaceState({}, '', url);
  }, [filtered]);

  const closeDrawer = useCallback(() => {
    setSelected(-1);
    const url = new URL(location.href);
    url.searchParams.delete('c');
    history.replaceState({}, '', url);
  }, []);

  // 分享链接带角色 id：结果就绪后自动展开
  useEffect(() => {
    if (!initial.current.char || !filtered.length) return;
    const idx = filtered.findIndex((c) => c.id === initial.current.char);
    if (idx >= 0) setSelected(idx);
    initial.current.char = '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  /* ── 键盘：Esc 关闭，← → 换角色 / 换日期 ───────────── */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { closeDrawer(); setFavOpen(false); return; }
      const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
      if (selected >= 0) {
        if (e.key === 'ArrowLeft' && selected > 0) openDrawer(selected - 1);
        if (e.key === 'ArrowRight' && selected < filtered.length - 1) openDrawer(selected + 1);
        return;
      }
      if (typing) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const step = e.key === 'ArrowRight' ? 1 : -1;
        let m = month;
        let d = day + step;
        if (d < 1) { m = m === 1 ? 12 : m - 1; d = daysInMonth(m); }
        if (d > daysInMonth(m)) { m = m === 12 ? 1 : m + 1; d = 1; }
        selectDate(m, d);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, filtered.length, month, day, openDrawer, closeDrawer, selectDate]);

  /* ── 浏览器前进 / 后退 ────────────────────────────── */
  useEffect(() => {
    const onPop = () => {
      const p = readParams();
      selectDate(p.month, p.day, { push: false, silent: true });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [selectDate]);

  /* ── 全局搜索 / 导出 / 分享 ───────────────────────── */
  const globalSearch = useCallback(async (setProgress) => {
    const all = await loadAll((p) => setProgress?.(p));
    setAllRows(all);
    setMode('search');
    const url = new URL(location.href);
    url.searchParams.set('mode', 'search');
    history.replaceState({}, '', url);
  }, []);

  const exportRows = (list, filename) => {
    if (!list.length) { notify('没有可导出的角色'); return; }
    download(filename, toCSV(list.map(toExportRow), EXPORT_COLUMNS));
    notify(`已导出 ${list.length} 条记录为 CSV`);
  };

  const share = async () => {
    const text = shareText(mode, month, day, rows.length, query);
    if (navigator.share) {
      try { await navigator.share({ title: '生诞绘卷', text, url: location.href }); return; } catch { /* 用户取消则复制 */ }
    }
    try { await navigator.clipboard.writeText(`${text}\n${location.href}`); notify('链接已复制到剪贴板'); }
    catch { notify(location.href); }
  };

  const nearDay = () => {
    for (let delta = 1; delta <= 14; delta += 1) {
      for (const dir of [1, -1]) {
        let m = month;
        let d = day + delta * dir;
        if (d < 1) { m -= 1; if (m < 1) m = 12; d = daysInMonth(m); }
        if (d > daysInMonth(m)) { m = m === 12 ? 1 : m + 1; d = 1; }
        if ((meta?.days?.[m - 1]?.[d] || 0) > 0) { selectDate(m, d); return; }
      }
    }
  };

  const randomDay = () => {
    const pool = [];
    (meta?.days || []).forEach((counts, mi) => counts.forEach((n, di) => { if (n > 0) pool.push([mi + 1, di]); }));
    if (!pool.length) return;
    const [m, d] = pool[Math.floor(Math.random() * pool.length)];
    selectDate(m, d);
  };

  // 自测 / 排障出口（tools/site-test.mjs 会用到）
  useEffect(() => {
    window.__spj = {
      selectDate,
      openDrawer,
      closeDrawer,
      routeChain,
      mountImage,
      loadedRouteOf,
      quickPalette,
      getState: () => ({ month, day, rows, filtered, meta, mode, favs, selected }),
    };
  }, [selectDate, openDrawer, closeDrawer, month, day, rows, filtered, meta, mode, favs, selected]);

  const current = selected >= 0 ? filtered[selected] : null;
  const heroPalette = pagePalette || (rows.length ? quickPalette(rows[0]) : null);

  return (
    <>
      <TopBar favCount={favs.length} onOpenFav={() => setFavOpen(true)} />

      {/* 页面主色带：当前角色的五个纯色方块 */}
      <div className="colorband" aria-hidden="true">
        <PaletteBlocks palette={heroPalette} height={8} />
      </div>

      <main>
        <Hero
          meta={meta}
          month={month}
          day={day}
          palette={heroPalette}
          onChange={(m, d) => selectDate(m, d)}
          onPickFeatured={(m, d) => selectDate(m, d)}
        />

        <Results
          mode={mode}
          month={month}
          day={day}
          rows={rows}
          totalOfDay={mode === 'search' && allRows ? allRows.length : rows.length}
          baseRows={baseRows}
          filtered={filtered}
          meta={meta}
          loading={loading}
          favIds={favIds}
          filters={{ q: query, sort, types, nsfw }}
          onFilterChange={(patch) => {
            if ('q' in patch) { setQuery(patch.q); if (!(mode === 'search' && allRows)) setMode('day'); }
            if ('sort' in patch) setSort(patch.sort);
            if ('types' in patch) setTypes(patch.types);
            if ('nsfw' in patch) setNsfw(patch.nsfw);
          }}
          onOpen={openDrawer}
          onToggleFav={toggleFav}
          onHover={onHover}
          onExport={() => exportRows(filtered, exportName(mode, month, day, query))}
          onShare={share}
          onGlobalSearch={globalSearch}
          onReset={() => { setTypes([]); setQuery(''); }}
          onRandom={randomDay}
          onNear={nearDay}
        />

        <Calendar meta={meta} month={month} day={day} palette={heroPalette} onPick={(m, d) => selectDate(m, d)} />
        <About meta={meta} />
      </main>

      <Footer />

      {current ? (
        <DetailDrawer
          char={current}
          index={selected}
          total={filtered.length}
          palette={cachedCardPalette(current.id) || quickPalette(current)}
          isFav={favIds.has(current.id)}
          onClose={closeDrawer}
          onPrev={() => openDrawer(selected - 1)}
          onNext={() => openDrawer(selected + 1)}
          onToggleFav={toggleFav}
          onCopy={(p) => { if (p) { rememberCardPalette(current.id, p); setPagePalette(p); } }}
          onNotify={notify}
        />
      ) : null}

      {favOpen ? (
        <FavoritesDrawer
          favs={favs}
          onClose={() => setFavOpen(false)}
          onOpen={(c) => {
            setFavOpen(false);
            selectDate(c.month, c.day).then(() => {
              const idx = filtered.findIndex((x) => x.id === c.id);
              if (idx >= 0) openDrawer(idx);
              else notify(`「${displayName(c)}」不在当前筛选结果里`);
            });
          }}
          onRemove={(c) => { persistFavs(favs.filter((f) => f.id !== c.id)); notify('已移除'); }}
          onExport={() => exportRows(favs, 'birthday-favorites.csv')}
          onClear={() => {
            if (!favs.length) { notify('收藏夹是空的'); return; }
            if (window.confirm('确定清空全部收藏吗？')) { persistFavs([]); notify('收藏夹已清空'); }
          }}
        />
      ) : null}

      <Toast message={toast} />
    </>
  );
}
