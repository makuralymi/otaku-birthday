/* ============================================================
   palette.js · 莫奈取色引擎（纯色版）
   1) 从立绘上部做 k-means 主色提取
   2) 把主色整理成一组「纯色」：底色 / 色块 / 强调色 / 文字色
      —— 全站不使用渐变，所有颜色都是可以直接铺满的实色
   3) 输出 CSS 变量，注入卡片、色块与页面主色区域
   没有 CORS 的图源（VNDB 直连）退化为数据集预计算色板 / 稳定哈希色
   ============================================================ */

// 允许 canvas 跨域取色的图源：原站 CDN + 两个代理线路
export const CORS_HOSTS = ['anilist.co', 'bgm.tv', 'i0.wp.com', 'wsrv.nl'];

export const isCorsImage = (url = '') => {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return true;
  if (!/^https?:/i.test(url)) return true;            // 同源相对路径
  try {
    const host = new URL(url).hostname.toLowerCase();
    return CORS_HOSTS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ── 色彩工具 ─────────────────────────────────────────── */
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return '#' + rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

export const hexToRgb = (hex) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || '').trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
};

export const rgbToHex = (c) => '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

/** 相对亮度 / 对比度（选文字色用，保证可读性） */
function luminance(hex) {
  const rgb = hexToRgb(hex) || [255, 255, 255];
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 在给定底色上挑一个够看的文字色 */
export function readableInk(bg, preferred = '#1b1a20') {
  if (contrast(bg, preferred) >= 4.5) return preferred;
  return contrast(bg, '#ffffff') >= contrast(bg, preferred) ? '#ffffff' : preferred;
}

/** 数据集里预存的 " #aaa #bbb" 色板字符串 → rgb 数组 */
export function parsePalette(str) {
  if (!str) return [];
  return str.split(/[\s,]+/).map(hexToRgb).filter(Boolean);
}

/** 无立绘时的确定性色板：同一个角色永远同一套颜色 */
export function hashColors(seed = '') {
  let h = 2166136261;
  for (let i = 0; i < String(seed).length; i += 1) {
    h ^= String(seed).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const base = Math.abs(h) % 360;
  return [base, base + 28, base - 30, base + 62, base + 172].map((hue, i) => {
    const hex = hslToHex(hue, 0.34 - i * 0.02, 0.62 + (i % 3) * 0.05);
    return hexToRgb(hex);
  });
}

/* ── k-means 取色（与构建期 Python 版同思路） ────────────── */
function kmeans(pixels, k = 5, iterations = 8) {
  if (!pixels.length) return [];
  const centers = [];
  const step = Math.max(1, Math.floor(pixels.length / k));
  for (let i = 0; i < k && i * step < pixels.length; i += 1) centers.push(pixels[i * step].slice());

  let buckets = [];
  for (let it = 0; it < iterations; it += 1) {
    buckets = centers.map(() => []);
    for (const px of pixels) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centers.length; c += 1) {
        const d = (px[0] - centers[c][0]) ** 2 + (px[1] - centers[c][1]) ** 2 + (px[2] - centers[c][2]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      buckets[best].push(px);
    }
    let moved = false;
    buckets.forEach((bucket, idx) => {
      if (!bucket.length) return;
      const avg = [0, 0, 0];
      for (const p of bucket) { avg[0] += p[0]; avg[1] += p[1]; avg[2] += p[2]; }
      avg[0] /= bucket.length; avg[1] /= bucket.length; avg[2] /= bucket.length;
      if (Math.abs(avg[0] - centers[idx][0]) > 1.5 || Math.abs(avg[1] - centers[idx][1]) > 1.5 || Math.abs(avg[2] - centers[idx][2]) > 1.5) moved = true;
      centers[idx] = avg;
    });
    if (!moved) break;
  }

  return centers
    .map((c, i) => {
      const [h, s, l] = rgbToHsl(c[0], c[1], c[2]);
      const weight = buckets[i] ? buckets[i].length / pixels.length : 0;
      const balance = clamp(1 - Math.abs(l - 0.55) * 1.25, 0.06, 1);
      const neutralPenalty = s < 0.06 ? 0.25 : 1;
      return { rgb: c.map((v) => Math.round(v)), score: weight ** 0.6 * (0.3 + s) * balance * neutralPenalty, weight };
    })
    .filter((x) => x.weight > 0.015)
    .sort((a, b) => b.score - a.score);
}

/** 从已加载的 <img> 提取主色（要求图片允许跨域读取） */
export function extractFromImage(img) {
  const size = 56;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    // 只取上部：立绘里最有个性的是头发与瞳色
    const cropH = Math.max(1, Math.floor((img.naturalHeight || img.height) * 0.72));
    ctx.drawImage(img, 0, 0, img.naturalWidth || img.width, cropH, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    const px = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 140) continue;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (lum > 0.965 && sat < 0.1) continue;   // 纯背景白
      if (lum < 0.05) continue;                  // 死黑
      px.push([r, g, b]);
    }
    if (px.length < 30) return null;
    const stride = Math.max(1, Math.floor(px.length / 1600));
    const sample = [];
    for (let i = 0; i < px.length; i += stride) sample.push(px[i]);
    return kmeans(sample, 5, 8).map((c) => c.rgb);
  } catch {
    return null;   // 画布被污染（无 CORS）
  }
}

/* ── 纯色方案：把主色整理成可用的实色 ─────────────────── */
export function flatPalette(colors, seed = '') {
  const raw = (colors && colors.length ? colors : hashColors(seed)).slice(0, 6);
  const hsl = raw.map((c) => rgbToHsl(c[0], c[1], c[2]));
  // 主角色的选取：彩度够、明度适中
  const main = [...hsl].sort(
    (a, b) => b[1] * (1 - Math.abs(b[2] - 0.55)) - a[1] * (1 - Math.abs(a[2] - 0.55)),
  )[0] || [215, 0.3, 0.6];
  const hue = main[0];
  const sat = clamp(main[1], 0.18, 1);

  // 5 个纯色块：同色相族里错开，全部是不透明的实色
  const blocks = [0, 1, 2, 3, 4].map((i) => hslToHex(
    hue + [-24, -8, 8, 26, 46][i],
    clamp(sat * 0.92 - i * 0.02 + 0.14, 0.26, 0.62),
    clamp(0.62 + (i % 3) * 0.07 - (i === 4 ? 0.05 : 0), 0.56, 0.78),
  ));

  // 卡片底色：极浅的实色（纯色，不是渐变）；文字用同色相深色
  const surface = hslToHex(hue, clamp(sat * 0.42, 0.06, 0.24), 0.955);
  const surfaceAlt = hslToHex(hue, clamp(sat * 0.5, 0.08, 0.3), 0.9);
  const line = hslToHex(hue, clamp(sat * 0.45, 0.1, 0.34), 0.84);
  let ink = hslToHex(hue, clamp(sat * 0.5, 0.12, 0.4), 0.24);
  if (contrast(surface, ink) < 7) ink = hslToHex(hue, 0.2, 0.16);

  const accent = hslToHex(hue - 4, clamp(sat * 1.05, 0.34, 0.64), 0.45);
  const accentInk = readableInk(accent, '#ffffff');

  return {
    raw: raw.map(rgbToHex),
    blocks,
    surface,
    surfaceAlt,
    line,
    ink,
    accent,
    accentInk,
  };
}

/* ── 缓存（内存 + localStorage） ──────────────────────── */
const mem = new Map();
const LS_KEY = 'spj:flat-palettes:v2';
let disk = null;
let diskDirty = false;

function loadDisk() {
  if (disk) return disk;
  try { disk = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { disk = {}; }
  return disk;
}
function saveDisk() {
  if (!diskDirty) return;
  diskDirty = false;
  try {
    const entries = Object.entries(loadDisk());
    disk = entries.length > 400 ? Object.fromEntries(entries.slice(-320)) : Object.fromEntries(entries);
    localStorage.setItem(LS_KEY, JSON.stringify(disk));
  } catch { /* 隐私模式忽略 */ }
}
if (typeof window !== 'undefined') setInterval(saveDisk, 3000);

const keyOf = (url) => {
  let h = 0;
  for (let i = 0; i < url.length; i += 1) h = (h * 31 + url.charCodeAt(i)) | 0;
  return 'p' + Math.abs(h).toString(36);
};

/** 取得角色色板：内存 → 本地缓存 → 实时取色 → 预计算 → 哈希生成 */
export async function paletteFor({ url, csvPalette, seed, img }) {
  const key = url ? keyOf(url) : 'seed:' + seed;
  if (mem.has(key)) return mem.get(key);

  const cached = loadDisk()[key];
  if (cached && cached.length) {
    const palette = flatPalette(parsePalette(cached.join(' ')), seed || url || 'x');
    mem.set(key, palette);
    return palette;
  }

  let colors = null;
  let source = 'hash';
  if (img && url && isCorsImage(url) && img.complete && img.naturalWidth) {
    colors = extractFromImage(img);
    if (colors) source = 'live';
  }
  if (!colors) {
    const pre = parsePalette(csvPalette);
    if (pre.length >= 2) { colors = pre; source = 'csv'; }
  }
  if (!colors) colors = hashColors(seed || url || 'x');

  if (url && source !== 'hash') {
    const d = loadDisk();
    d[key] = colors.map(rgbToHex);
    diskDirty = true;
  }
  const palette = flatPalette(colors, seed || url || 'x');
  mem.set(key, palette);
  return palette;
}

/** 把色板铺到页面级 CSS 变量（纯色，只有颜色过渡，没有渐变） */
export function applyGlobalPalette(palette, root = document.documentElement) {
  if (!palette) return;
  root.style.setProperty('--m-block-1', palette.blocks[0]);
  root.style.setProperty('--m-block-2', palette.blocks[1]);
  root.style.setProperty('--m-block-3', palette.blocks[2]);
  root.style.setProperty('--m-block-4', palette.blocks[3]);
  root.style.setProperty('--m-block-5', palette.blocks[4]);
  root.style.setProperty('--m-surface', palette.surface);
  root.style.setProperty('--m-surface-alt', palette.surfaceAlt);
  root.style.setProperty('--m-line', palette.line);
  root.style.setProperty('--m-ink', palette.ink);
  root.style.setProperty('--m-accent', palette.accent);
  root.style.setProperty('--m-accent-ink', palette.accentInk);
}

/** 卡片局部色（同一套纯色变量，作用域收在卡片上） */
export function cardVars(palette) {
  if (!palette) return {};
  return {
    '--c-surface': palette.surface,
    '--c-surface-alt': palette.surfaceAlt,
    '--c-line': palette.line,
    '--c-ink': palette.ink,
    '--c-accent': palette.accent,
    '--c-accent-ink': palette.accentInk,
    '--c-block-1': palette.blocks[0],
    '--c-block-2': palette.blocks[1],
    '--c-block-3': palette.blocks[2],
  };
}

/* ── 卡片级色板缓存（React 重渲染时秒回，不用重新取色） ── */
const cardCache = new Map();

/** 立即可用的近似色板：优先用数据集预计算色板，其次按 id 生成 */
export function quickPalette(char) {
  const pre = parsePalette(char?.palette);
  return flatPalette(pre.length > 1 ? pre : hashColors(char?.id || 'x'), char?.id || 'x');
}

export const cachedCardPalette = (id) => cardCache.get(id) || null;
export const rememberCardPalette = (id, palette) => { cardCache.set(id, palette); return palette; };

/** 取色：命中缓存直接用，否则等图片加载完实时取色 */
export async function paletteForCard(char, img) {
  const hit = cardCache.get(char.id);
  if (hit) return hit;
  const loaded = img && img.complete && img.naturalWidth
    ? { url: img.currentSrc || img.src, cors: isCorsImage(img.currentSrc || img.src) }
    : { url: char.thumb || char.image, cors: false };
  const palette = await paletteFor({
    url: loaded.url,
    csvPalette: char.palette,
    seed: char.id,
    img: img && loaded.cors && img.naturalWidth ? img : null,
  });
  return rememberCardPalette(char.id, palette);
}

/** 两个实色之间线性混合，得到另一个**纯色**（用于热力图分级，不是 CSS 渐变） */
export function mixHex(a, b, t) {
  const ca = hexToRgb(a) || [255, 255, 255];
  const cb = hexToRgb(b) || [0, 0, 0];
  return rgbToHex([0, 1, 2].map((i) => ca[i] + (cb[i] - ca[i]) * Math.min(1, Math.max(0, t))));
}
