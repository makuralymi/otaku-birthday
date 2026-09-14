/* ============================================================
   data.js · 数据集读取层（多线路）
   data/meta.json       统计元数据：日历热力图、来源分布、精选角色
   data/months/MM.csv   按月分片，按需加载
   data/characters.csv  全量单文件（分片失败时兜底 / 无 meta 时现算）
   ============================================================ */

import { CONFIG } from './config.js';
import { loadLocalManifest } from './images.js';
import { parseCSV } from './csv.js';

const DAY_CACHE = new Map();
let META = null;
let INDEX_CACHE = null;   // 瘦身搜索索引：跨月搜索 + 分片失败兜底

export const pad2 = (n) => String(n).padStart(2, '0');
export const MONTH_NAMES = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
export const monthName = (m) => MONTH_NAMES[m - 1] || `${m}月`;
export const TYPE_ORDER = ['动画', '漫画', '轻小说', '游戏', 'Galgame', '其他'];
export const SRC_LABEL = {
  anilist: { name: 'AniList', url: 'https://anilist.co' },
  vndb: { name: 'VNDB', url: 'https://vndb.org' },
  bangumi: { name: 'Bangumi 番组计划', url: 'https://bgm.tv' },
};

/** 多线路取数：按顺序尝试，全部失败才抛错 */
async function fetchFirst(urls, { parse = 'text', cache = 'no-cache' } = {}) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache });
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      return parse === 'json' ? await res.json() : await res.text();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('所有线路都失败了');
}

/** CSV 行 → 前端结构 */
export function normalize(row) {
  let works = [];
  if (row.works) {
    try { works = JSON.parse(row.works); } catch { works = []; }
  }
  if (!works.length && row.work) {
    works = [{ t: row.work, cn: row.work_cn || '', ty: row.ptype, y: row.work_year, pop: 0 }];
  } else if (row.work && !works.some((w) => w.t === row.work)) {
    works.unshift({ t: row.work, cn: row.work_cn || '', ty: row.ptype, y: row.work_year, pop: 0 });
  }
  return {
    id: row.id,
    src: row.src,
    month: +row.month,
    day: +row.day,
    year: row.year || '',
    nameCn: row.name_cn || '',
    nameNative: row.name_native || '',
    nameRomaji: row.name_romaji || '',
    altNames: row.alt_names || '',
    gender: row.gender || '',
    blood: row.blood || '',
    age: row.age || '',
    types: (row.types || '').split('|').filter(Boolean),
    ptype: row.ptype || '',
    work: row.work || '',
    workCn: row.work_cn || '',
    workYear: row.work_year || '',
    works,
    summary: row.summary || '',
    full: row.summary !== undefined,            // 是否来自完整分片（索引里没有简介）
    heat: +row.heat || 0,
    fav: +row.fav || 0,
    votes: +row.votes || 0,
    collects: +row.collects || 0,
    nsfw: row.nsfw === '1',
    image: row.image || '',
    thumb: row.thumb || row.image || '',
    alts: (row.alts || '').split('|').filter(Boolean),
    palette: row.palette || '',
    tags: (row.tags || '').split(' ').filter(Boolean),
    urlAl: row.url_al || '',
    urlBgm: row.url_bgm || '',
    urlVndb: row.url_vndb || '',
    bgmId: row.bgm_id || '',
  };
}

/** 展示名：中文名 → 日文原名 → 罗马音 */
export const displayName = (c) => c.nameCn || c.nameNative || c.nameRomaji || '未知角色';

/** 次要名：确实不同于主名时才显示 */
export function subName(c) {
  const main = displayName(c);
  return [c.nameNative, c.nameRomaji].find((x) => x && x !== main && !main.includes(x)) || '';
}

export const primaryWork = (c) => c.workCn || c.work || '未知作品';

const dim = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const daysInMonth = (m) => dim[m - 1] || 31;

/** 统计数据；meta.json 挂了就用全量 CSV 现算 */
export async function loadMeta() {
  if (META) return META;
  await loadLocalManifest();
  try {
    META = await fetchFirst(CONFIG.dataRoutes.meta, { parse: 'json' });
  } catch {
    META = deriveMeta(await loadIndex());
  }
  return META;
}

function deriveMeta(rows) {
  const days = dim.map((n) => [0, ...new Array(n).fill(0)]);
  const types = {};
  const sources = {};
  rows.forEach((r) => {
    if (days[r.month - 1] && r.day <= dim[r.month - 1]) days[r.month - 1][r.day] += 1;
    (r.types || []).forEach((t) => { types[t] = (types[t] || 0) + 1; });
    sources[r.src] = (sources[r.src] || 0) + 1;
  });
  const flat = days.flatMap((d) => d.slice(1));
  return {
    generated_at: new Date().toISOString().slice(0, 10),
    total: rows.length,
    sources,
    types,
    months: days.map((d) => d.slice(1).reduce((a, b) => a + b, 0)),
    days,
    days_flat: flat,
    max_day: Math.max(1, ...flat),
    featured: rows.slice(0, 24).map((r) => ({
      id: r.id, n: displayName(r), nn: r.nameNative, m: r.month, d: r.day,
      ty: r.ptype, w: primaryWork(r), img: r.thumb, p: r.palette,
    })),
    columns: [],
    derived: true,
  };
}

/** 某一天的全部角色：按天分片（几十 KB），失败则退回搜索索引（瘦身版） */
export async function loadDay(month, day) {
  const key = `${month}-${day}`;
  if (DAY_CACHE.has(key)) return DAY_CACHE.get(key);
  const promise = (async () => {
    try {
      const text = await fetchFirst(CONFIG.dataRoutes.day(month, day));
      return parseCSV(text).rows.map(normalize);
    } catch (err) {
      const index = await loadIndex();
      const rows = index.filter((r) => r.month === month && r.day === day);
      if (!rows.length) throw err;
      return rows;   // 索引里没有简介/作品明细，但卡片仍可正常渲染
    }
  })();
  DAY_CACHE.set(key, promise);
  return promise;
}

/** 瘦身搜索索引（一次加载，几 MB；用于跨月搜索与兜底） */
export async function loadIndex() {
  if (!INDEX_CACHE) {
    INDEX_CACHE = (async () => {
      const text = await fetchFirst(CONFIG.dataRoutes.index);
      return parseCSV(text).rows.map(normalize);
    })();
  }
  return INDEX_CACHE;
}

/** 跨月搜索用的全量数据（= 搜索索引） */
export async function loadAll(onProgress) {
  const index = await loadIndex();
  onProgress?.(1);
  return index;
}
