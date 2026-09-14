/* ============================================================
   images.js · 立绘多线路调取与兜底
   依次尝试，任一条成功即停：
     ① 本地缓存（如构建时缓存过，离线可用）
     ② 主线路：原站 CDN（AniList / Bangumi / VNDB）
     ③ 跨站备用：另一数据库的同一角色立绘（数据里的 alts 列）
     ④ 同内容镜像域名（VNDB 的 t.vndb.org ↔ s.vndb.org）
     ⑤ 第三方图片代理（可跨域 + 缩放）
     ⑥ 终端兜底：本地生成的纯色占位图（永不失败）
   ============================================================ */

import { CONFIG } from './config.js';
import { flatPalette, hashColors, parsePalette, isCorsImage } from './palette.js';

const MANIFEST = { loaded: false, images: {} };

const hostOf = (url) => {
  try {
    return new URL(url, location.href).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/** 本地缓存清单（可选的一层线路） */
export async function loadLocalManifest() {
  if (MANIFEST.loaded) return MANIFEST.images;
  MANIFEST.loaded = true;
  try {
    const res = await fetch(CONFIG.localManifest, { cache: 'force-cache' });
    if (res.ok) {
      const data = await res.json();
      MANIFEST.images = data.images || {};
    }
  } catch { /* 没有缓存清单是正常情况 */ }
  return MANIFEST.images;
}

export const hasLocalManifest = () => Object.keys(MANIFEST.images).length > 0;

function mirrorsOf(url) {
  const host = hostOf(url);
  if (!host) return [];
  return (CONFIG.hostMirrors[host] || []).map((h) => {
    const u = new URL(url, location.href);
    u.hostname = h;
    return u.href;
  });
}

function proxiesOf(url, width) {
  if (!CONFIG.proxies.length) return [];
  try {
    const u = new URL(url, location.href);
    if (!/^https?:$/.test(u.protocol)) return [];
    return CONFIG.proxies.map((p) => ({ name: p.name, url: p.build(u.hostname, u.pathname, width) }));
  } catch {
    return [];
  }
}

/** 为一个角色生成完整线路表 */
export function routeChain(char, { size = 'thumb' } = {}) {
  const width = size === 'large' ? CONFIG.largeWidth : CONFIG.thumbWidth;
  const primary = size === 'large' ? (char.image || char.thumb) : (char.thumb || char.image);
  const alts = (char.alts || []).filter(Boolean);
  const chain = [];
  const push = (url, route) => {
    if (!url || chain.some((c) => c.url === url)) return;
    chain.push({ url, route, cors: isCorsImage(url) });
  };

  if (CONFIG.preferLocal) {
    const local = MANIFEST.images[char.id];
    const localUrl = typeof local === 'string' ? local : local?.[size] || local?.thumb;
    if (localUrl) push(localUrl, 'local');
  }
  push(primary, 'origin');
  alts.forEach((url, i) => push(url, i === 0 ? 'alternate' : `alternate+${i}`));
  [primary, ...alts].forEach((url) => mirrorsOf(url || '').forEach((m) => push(m, 'mirror')));
  if (primary) proxiesOf(primary, width).forEach((p) => push(p.url, `proxy:${p.name}`));
  if (alts[0]) proxiesOf(alts[0], width).forEach((p) => push(p.url, `proxy-alt:${p.name}`));
  return chain;
}

/** 终端兜底：用角色自己的色板现画一张纯色占位图（SVG data URI，零网络） */
export function placeholderURI(char) {
  const colors = parsePalette(char.palette);
  const pal = flatPalette(colors.length > 1 ? colors : hashColors(char.id || 'x'), char.id || 'x');
  const initial = ((char.nameCn || char.nameNative || char.nameRomaji || '?').trim()[0] || '?')
    .replace(/[<>&"']/g, '');
  const [block1, block2, block3] = pal.blocks;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">`
    + `<rect width="300" height="400" fill="${pal.surface}"/>`
    + `<rect x="0" y="0" width="300" height="14" fill="${block1}"/>`
    + `<rect x="0" y="14" width="150" height="8" fill="${block2}"/>`
    + `<rect x="150" y="14" width="150" height="8" fill="${block3}"/>`
    + `<text x="150" y="240" text-anchor="middle" font-size="132" font-family="Songti SC,Noto Serif SC,serif"`
    + ` fill="${pal.ink}" fill-opacity="0.9">${initial}</text>`
    + `</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/**
 * 给 <img> 挂上多线路兜底加载
 * @returns 当前线路对象
 */
export function mountImage(img, chain, { char, onRoute, priority = false } = {}) {
  if (!img) return null;
  let index = 0;
  const apply = (c) => {
    if (c.cors) img.setAttribute('crossorigin', 'anonymous');
    else img.removeAttribute('crossorigin');
    img.referrerPolicy = CONFIG.referrerPolicy;
    img.dataset.route = c.route;
    img.src = c.url;
    if (onRoute) onRoute(c);
    return c;
  };
  const next = () => {
    if (index >= chain.length) {
      img.dataset.route = 'placeholder';
      img.removeAttribute('crossorigin');
      img.src = placeholderURI(char || {});
      return null;
    }
    return apply(chain[index++]);
  };
  img.addEventListener('error', next);
  if (priority) img.setAttribute('fetchpriority', 'high');
  return next();
}

/** 当前实际生效的线路（取色时判断能不能读画布） */
export const loadedRouteOf = (img) => {
  const url = img?.currentSrc || img?.src || '';
  return { url, cors: isCorsImage(url), route: img?.dataset?.route || '' };
};
