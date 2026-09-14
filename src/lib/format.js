/* ============================================================
   format.js · 展示与导出的小工具
   ============================================================ */

import { displayName, primaryWork } from './data.js';

/** 12345 → 1.2w；1234 → 1.2k */
export const compact = (n) => {
  const v = Number(n) || 0;
  if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + 'w';
  if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(v);
};

export const EXPORT_COLUMNS = [
  'id', 'src', 'month', 'day', 'year', 'name_cn', 'name_native', 'name_romaji', 'alt_names',
  'gender', 'blood', 'age', 'types', 'ptype', 'work', 'work_cn', 'work_year', 'works',
  'summary', 'heat', 'fav', 'votes', 'collects', 'nsfw', 'image', 'thumb', 'alts', 'palette',
  'tags', 'url_al', 'url_bgm', 'url_vndb', 'bgm_id',
];

/** 前端结构 → 与数据集一致的 CSV 行 */
export const toExportRow = (c) => ({
  id: c.id,
  src: c.src,
  month: c.month,
  day: c.day,
  year: c.year,
  name_cn: c.nameCn,
  name_native: c.nameNative,
  name_romaji: c.nameRomaji,
  alt_names: (c.altNames || '').replace(/ \/ /g, ' | '),
  gender: c.gender,
  blood: c.blood,
  age: c.age,
  types: c.types.join('|'),
  ptype: c.ptype,
  work: c.work,
  work_cn: c.workCn,
  work_year: c.workYear,
  works: JSON.stringify(c.works.map((w) => ({ t: w.t || '', cn: w.cn || '', ty: w.ty || '', y: w.y || '' }))),
  summary: c.summary,
  heat: c.heat,
  fav: c.fav,
  votes: c.votes,
  collects: c.collects,
  nsfw: c.nsfw ? 1 : '',
  image: c.image,
  thumb: c.thumb,
  alts: (c.alts || []).join('|'),
  palette: c.palette,
  tags: c.tags.join(' '),
  url_al: c.urlAl,
  url_bgm: c.urlBgm,
  url_vndb: c.urlVndb,
  bgm_id: c.bgmId,
});

/** 搜索结果 / 当天结果的文件名 */
export const exportName = (mode, month, day, q) => (mode === 'search'
  ? `birthday-search-${(q || 'all').slice(0, 12)}.csv`
  : `birthday-${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}.csv`);

export const shareText = (mode, month, day, count, q) => (mode === 'search'
  ? `生诞绘卷 · 搜索「${q}」`
  : `${month} 月 ${day} 日生日的二次元角色（${count} 位）`);

/** 外链集合 */
export const linksOf = (c) => [
  c.urlAl && { label: 'AniList 条目', href: c.urlAl },
  c.urlBgm && { label: 'Bangumi 条目', href: c.urlBgm },
  c.urlVndb && { label: 'VNDB 条目', href: c.urlVndb },
  {
    label: '萌娘百科搜索',
    href: `https://zh.moegirl.org.cn/index.php?search=${encodeURIComponent(displayName(c))}`,
  },
  {
    label: 'Google',
    href: `https://www.google.com/search?q=${encodeURIComponent(`${displayName(c)} 生日`)}`,
  },
].filter(Boolean);

export { displayName, primaryWork };
