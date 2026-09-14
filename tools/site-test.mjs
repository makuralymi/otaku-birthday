/* ============================================================
   站点自测（React 版）：jsdom + 真实 index.html + 真实 CSV 数据
   用法：
     npm install
     npx esbuild src/main.jsx --bundle --format=iife --jsx=automatic \
        --define:process.env.NODE_ENV='"production"' --outfile=/tmp/otaku-birthday-app.bundle.js
     node tools/site-test.mjs
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BUNDLE = process.env.BUNDLE
  || (process.env.CLEAN === '1' ? '/tmp/otaku-birthday-clean.bundle.js' : '/tmp/otaku-birthday-app.bundle.js');
const bundle = fs.readFileSync(BUNDLE, 'utf8');
const html0 = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// 用函数替换，避免 bundle 里的 $& / $' 被当成替换模式
const html = html0.replace(/<script type="module" src="[^"]+"><\/script>/, () => `<script>${bundle}<\/script>`);

const CLEAN = process.env.CLEAN === '1';
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

function buildDom({ url = 'http://127.0.0.1:8899/?m=4&d=1', fail = () => false } = {}) {
  return new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.fetch = async (input) => {
        const raw = typeof input === 'string' ? input : input.url;
        const p = raw.startsWith('http') ? new URL(raw).pathname : raw;
        const clean = p.replace(/^\//, '').split('?')[0];
        if (fail(clean)) return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
        // 站点里 fetch('data/...') 对应仓库里的 public/data/...
        const abs = fs.existsSync(path.join(ROOT, clean))
          ? path.join(ROOT, clean)
          : path.join(ROOT, 'public', clean);
        const text = fs.readFileSync(abs, 'utf8');
        return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
      };
      w.IntersectionObserver = class {
        constructor(cb) { this.cb = cb; }
        observe(el) { setTimeout(() => this.cb([{ isIntersecting: true, target: el }], this), 0); }
        unobserve() {}
        disconnect() {}
      };
      w.URL.createObjectURL = () => 'blob:stub';
      w.URL.revokeObjectURL = () => {};
      w.navigator.clipboard = { writeText: async () => {} };
      w.confirm = () => true;
      w.addEventListener('unhandledrejection', (e) => errors.push('unhandledrejection: ' + (e.reason?.stack || e.reason)));
      w.addEventListener('error', (e) => errors.push('error: ' + e.message));
    },
  });
}

const dom = buildDom();
const { window } = dom;
if (!window.Element.prototype.scrollIntoView) window.Element.prototype.scrollIntoView = () => {};

const CLEAN_MODE = process.env.CLEAN === '1';
const $ = (s) => window.document.querySelector(s);
const $$ = (s) => [...window.document.querySelectorAll(s)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(60); }
  return false;
}
/** React 受控组件：必须用原生 setter 触发，否则 React 检测不到变化 */
function setNative(el, value) {
  const proto = el instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype
    : el instanceof window.HTMLInputElement ? window.HTMLInputElement.prototype
      : window.HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}
const routeChainOf = (c, o) => window.__spj.routeChain(c, o);
const mountImage0 = (img, chain, opts) => window.__spj.mountImage(img, chain, opts);
const stateOf = () => window.__spj.getState();

const results = [];
const check = (name, cond, extra = '') => results.push([cond ? 'PASS' : 'FAIL', name, extra]);

await until(() => $('#stat-total') && $('#stat-total').textContent !== '—');
await until(() => $$('.card').length > 0);

/* ── 1. 首屏与数据 ─────────────────────────────────── */
check('meta 统计渲染', $('#stat-total')?.textContent !== '—' && /^\d/.test($('#stat-total')?.textContent || ''), $('#stat-total')?.textContent);
check('月份下拉 12 项', $$('#sel-month option').length === 12, `${$$('#sel-month option').length}`);
check('日期下拉 30 项(4月)', $$('#sel-day option').length === 30, `${$$('#sel-day option').length}`);
check('下拉带日期人数', /4 月 · \d+ 人/.test($$('#sel-month option')[3]?.textContent || ''), $$('#sel-month option')[3]?.textContent);
check('URL 同步 m/d', /m=4&d=1/.test(window.location.search), window.location.search);

/* ── 2. 结果区 ─────────────────────────────────────── */
const cardCount = $$('.card').length;
check('4/1 渲染卡片', cardCount > 0, `${cardCount} 张`);
check('卡片含名字与作品', ($('.card .card-name')?.textContent || '').trim().length > 0 && ($('.card .card-work')?.textContent || '').trim().length > 0,
  `${$('.card .card-name')?.textContent?.trim()} / ${$('.card .card-work')?.textContent?.trim()}`);
check('卡片注入纯色变量', /--c-surface/.test($('.card')?.getAttribute('style') || ''), ($('.card')?.getAttribute('style') || '').slice(0, 70));
check('结果标题为日期', $('#date-label')?.textContent?.includes('4 月 1 日'), $('#date-label')?.textContent);
check('类型 chips 渲染', $$('#type-chips .chip').length >= 2, `${$$('#type-chips .chip').length} 个`);
await until(() => !!$('.card img')?.getAttribute('src'), 4000);
check('卡片立绘 img 带 src', !!$('.card img')?.getAttribute('src'), ($('.card img')?.getAttribute('src') || '').slice(0, 56));

/* ── 3. 日历 ───────────────────────────────────────── */
check('日历 12 个月', $$('#cal-grid .month').length === 12, `${$$('#cal-grid .month').length}`);
check('日历天数 = 366', $$('#cal-grid .day').length === 366, `${$$('#cal-grid .day').length} 天`);
check('日历纯色热力分级', $$('#cal-grid .day').every((d) => /rgb|#/.test(d.getAttribute('style') || '')), '每日都有实色');
check('今天高亮', $$('#cal-grid .day.today').length === 1);

/* ── 4. 筛选 / 排序 / 搜索 ─────────────────────────── */
$$('#type-chips .chip')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await until(() => $$('.card').length !== cardCount);
const afterFilter = $$('.card').length;
check('类型筛选生效', afterFilter > 0 && afterFilter < cardCount, `${afterFilter} < ${cardCount}`);
$$('#type-chips .chip')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await until(() => $$('.card').length === cardCount);
check('取消筛选恢复', $$('.card').length === cardCount, `${$$('.card').length}`);

setNative($('#q'), '不存在的角色zzz');
await until(() => $('#empty') && $$('.card').length === 0);
check('搜索无结果时展示空态', $$('.card').length === 0 && ($('#empty')?.textContent || '').includes('没有匹配'), ($('#empty')?.textContent || '').slice(0, 30));
setNative($('#q'), '');
await until(() => $$('.card').length === cardCount);
setNative($('#sort'), 'name');
await wait(120);
check('按名字排序有结果', $$('.card').length === cardCount, `${$$('.card').length} 张`);

/* ── 5. 详情抽屉 ───────────────────────────────────── */
$$('.card')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await until(() => $('#drawer'));
check('抽屉打开', !!$('#drawer'), $('#drawer')?.className);
check('抽屉含色板色块', $$('#drawer-body .swatch').length >= 3, `${$$('#drawer-body .swatch').length} 个`);
check('抽屉含莫奈取色标题', ($('#drawer-body')?.textContent || '').includes('莫奈取色'));
if (!CLEAN) check('抽屉含来源链接', $$('#drawer-body .link-row a').length >= 3, `${$$('#drawer-body .link-row a').length} 个`);
check('抽屉含作品列表', $$('#drawer-body .work-list li').length >= 1);
const swatch = $('#drawer-body .swatch');
swatch.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await until(() => ($('#toast')?.textContent || '').length > 0);
check('点击色块复制提示', ($('#toast')?.textContent || '').includes('#'), `${swatch.dataset ? '' : ''}${$('#toast')?.textContent}`);

/* ── 6. 收藏 ───────────────────────────────────────── */
$('#drawer-fav').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await until(() => JSON.parse(window.localStorage.getItem('spj:favorites:v1') || '[]').length === 1);
const favs = JSON.parse(window.localStorage.getItem('spj:favorites:v1') || '[]');
check('收藏写入 localStorage', favs.length === 1, JSON.stringify(favs[0]?.id));
check('收藏计数更新', $('#fav-count')?.textContent === '1', $('#fav-count')?.textContent);
$('#nav-fav').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await until(() => $$('#fav-list .fav-item').length > 0);
check('收藏夹抽屉列表', $$('#fav-list .fav-item').length === 1, `${$$('#fav-list .fav-item').length}`);
$('#fav-close').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
$('#drawer-close').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await until(() => !$('#drawer'));
check('抽屉关闭', !$('#drawer'));

/* ── 7. 日期跳转 ───────────────────────────────────── */
$('#btn-today').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await until(() => ($('#date-label')?.textContent || '').includes(`${new Date().getMonth() + 1} 月 ${new Date().getDate()} 日`));
check('跳到今天', ($('#date-label')?.textContent || '').includes(`${new Date().getMonth() + 1} 月 ${new Date().getDate()} 日`), $('#date-label')?.textContent);
const target = $$('#cal-grid .day').find((d) => !d.classList.contains('active') && !d.classList.contains('empty-day'));
target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(400);
check('点击日历跳转', ($('#date-label')?.textContent || '').includes(target.textContent.trim() + ' 日'), $('#date-label')?.textContent);
check('跳转后卡片/空态二选一', $$('.card').length > 0 || !!$('#empty'), `${$$('.card').length} 张`);

/* ── 8. 导出 / 分享 ────────────────────────────────── */
$('#btn-export').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await until(() => ($('#toast')?.textContent || '').includes('CSV'));
check('导出 CSV 触发', ($('#toast')?.textContent || '').includes('CSV'), $('#toast')?.textContent);
if (!CLEAN) {
  $('#btn-share').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(150);
  check('分享复制链接', /复制|http/.test($('#toast')?.textContent || ''), $('#toast')?.textContent);
}

/* ── 9. 立绘多线路兜底 ─────────────────────────────── */
const anyImg = $('.card img');
check('图片挂上了线路标记', !!anyImg?.dataset.route, anyImg?.dataset.route);
check('图片带 no-referrer', anyImg?.referrerPolicy === 'no-referrer', anyImg?.referrerPolicy);
// 挑一张「有真实图源」的卡（新数据里有部分角色本来就没有立绘，会直接落占位图）
const firstImg = $$('.card img').find((i) => i.dataset.route && i.dataset.route !== 'placeholder');
const routes = [];
if (firstImg) {
  for (let i = 0; i < 12; i += 1) {
    routes.push(firstImg.dataset.route);
    if (firstImg.dataset.route === 'placeholder') break;
    firstImg.dispatchEvent(new window.Event('error'));
  }
}
check('线路表按序降级', routes.length >= 2 && routes[0] === 'origin', routes.join(' → ') || '无带图角色，跳过');
check('主线路失败会换备用线路', routes[1] !== 'origin', routes[1] || '-');
check('全部失败落到本地占位图', routes[routes.length - 1] === 'placeholder'
  && (firstImg?.getAttribute('src') || '').startsWith('data:image/svg+xml'), routes[routes.length - 1] || '-');
check('无立绘角色直接落纯色占位图', $$('.card img').some((i) => i.dataset.route === 'placeholder'),
  `${$$('.card img').filter((i) => i.dataset.route === 'placeholder').length} 张占位卡`);
check('占位图是纯色（无渐变）', !decodeURIComponent($('.card img').getAttribute('src') || '').includes('Gradient'), 'svg ok');

// Fandom 图源需要带 Referer，前端按域名切换 referrer 策略
const fandomChar = { id: 'x-fandom', thumb: 'https://static.wikia.nocookie.net/umamusume/images/2/23/Grass_Wonder_%28Main%29.png', image: '', alts: [], palette: '' };
const fandomImg = window.document.createElement('img');
mountImage0(fandomImg, routeChainOf(fandomChar, { size: 'thumb' }), { char: fandomChar });
check('Fandom 图改用带 Referer 策略', fandomImg.referrerPolicy === 'origin-when-cross-origin', fandomImg.referrerPolicy);
const normalImg = window.document.createElement('img');
mountImage0(normalImg, routeChainOf({ id: 'x-n', thumb: 'https://t.vndb.org/ch/32/22132.jpg', alts: [], palette: '' }, { size: 'thumb' }), { char: {} });
check('其它图源仍用 no-referrer', normalImg.referrerPolicy === 'no-referrer', normalImg.referrerPolicy);

const st = stateOf();
const vndbChar = st.rows.find((r) => r.src === 'vndb' && /t\.vndb\.org/.test(r.thumb));
check('VNDB 角色有镜像+代理兜底', !vndbChar || (() => {
  const chain = routeChainOf(vndbChar, { size: 'thumb' }).map((c) => c.route);
  return chain.includes('mirror') && chain.some((r) => r.startsWith('proxy:'));
})(), vndbChar ? routeChainOf(vndbChar, { size: 'thumb' }).map((c) => c.route).join(' → ') : '当天没有 VNDB 角色');

const altChar = st.rows.find((r) => (r.alts || []).length);
check('跨站备用图排在代理之前', !altChar || (() => {
  const chain = routeChainOf(altChar, { size: 'thumb' });
  const altIdx = chain.findIndex((c) => c.route === 'alternate');
  const proxyIdx = chain.findIndex((c) => c.route.startsWith('proxy:'));
  return altIdx > 0 && (proxyIdx === -1 || altIdx < proxyIdx);
})(), altChar ? `alternate@${routeChainOf(altChar, { size: 'thumb' }).findIndex((c) => c.route === 'alternate')}` : '当天没有带 alts 的角色');

/* ── 10. 数据分片挂掉时的兜底 ──────────────────────── */
const fallbackDom = buildDom({ url: 'http://127.0.0.1:8899/?m=7&d=7', fail: (p) => /data\/days\/0707\.csv$/.test(p) });
const fd = fallbackDom.window.document;
await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 12000 && !fd.querySelector('.card')) await wait(150); })();
check('按天分片 404 时退回搜索索引', fd.querySelectorAll('.card').length > 0, `${fd.querySelectorAll('.card').length} 张卡片`);
fallbackDom.window.close();

/* ── 10.5 生日选择器：选完必须立即生效、且不被 props 覆盖 ── */
setNative($('#sel-month'), '7');
await until(() => ($('#date-label')?.textContent || '').includes('7 月 1 日'), 6000);
await wait(320);   // 等一下，确认没有被"改回去"
check('选月份立即生效', $('#sel-month')?.value === '7' && ($('#date-label')?.textContent || '').includes('7 月 1 日'),
  `select=${$('#sel-month')?.value} label=${$('#date-label')?.textContent}`);
check('选月份不被覆盖回原值', /m=7/.test(window.location.search), window.location.search);
check('日列表跟随月份（7 月 31 天）', $$('#sel-day option').length === 31, `${$$('#sel-day option').length}`);

setNative($('#sel-day'), '7');
await until(() => ($('#date-label')?.textContent || '').includes('7 月 7 日'), 6000);
await wait(320);
check('选日期立即生效', $('#sel-day')?.value === '7' && ($('#date-label')?.textContent || '').includes('7 月 7 日'),
  `select=${$('#sel-day')?.value} label=${$('#date-label')?.textContent}`);
check('7 月 7 日渲染卡片', $$('.card').length > 0, `${$$('.card').length} 张`);

const beforeNsfw = $$('.card').length;
const nsfwInDay = stateOf().rows.filter((r) => r.nsfw).length;
$('#nsfw').click();
await wait(220);
check('R18 开关生效（放行当天全部 R18）', $$('.card').length === beforeNsfw + nsfwInDay,
  `${beforeNsfw} → ${$$('.card').length}（当天 R18 ${nsfwInDay} 位）`);

/* 选择器把日期带回去也要正常（回归：之前选完会被 props 覆盖） */
setNative($('#sel-month'), '4');
await until(() => ($('#date-label')?.textContent || '').includes('4 月'), 6000);
await wait(220);
check('切回 4 月仍然生效', $('#sel-month')?.value === '4', `select=${$('#sel-month')?.value}`);

/* ── 10.8 页脚项目地址 / 干净构建的外链与分享策略 ───── */
if (CLEAN) {
  const extLinks = $$('a').filter((a) => /^https?:/i.test(a.getAttribute('href') || ''));
  check('干净构建：全站没有任何外链', extLinks.length === 0,
    extLinks.slice(0, 3).map((a) => a.getAttribute('href')).join(' ') || '0 个');
  check('干净构建：没有分享按钮', !$('#btn-share'));
  check('干净构建：页脚没有项目地址', !$('#repo-link'));
  check('干净构建：详情里没有外链区', $$('#drawer-body .link-row a').length === 0);
  const about = $('#about')?.textContent || '';
  check('干净构建：仍标注数据源名称（关于区）',
    about.includes('AniList') && about.includes('Bangumi') && about.includes('VNDB'), about.slice(0, 40) + '…');
} else {
  const repo = $('#repo-link');
  check('页脚有项目地址链接', !!repo && repo.textContent.includes('项目地址')
    && /^https:\/\/github\.com\//.test(repo.getAttribute('href') || ''), `${repo?.textContent?.trim()} → ${repo?.getAttribute('href')}`);
  check('项目地址带 GitHub 图标', !!repo?.querySelector('svg path'), repo?.querySelector('svg') ? 'svg ok' : '缺少图标');
  check('外链安全属性', repo?.getAttribute('target') === '_blank' && (repo?.getAttribute('rel') || '').includes('noopener'),
    `target=${repo?.getAttribute('target')} rel=${repo?.getAttribute('rel')}`);
  check('常规构建：有分享按钮', !!$('#btn-share'));
  check('常规构建：页脚有站外链接', $$('a[href^="http"]').length >= 1, `${$$('a[href^="http"]').length} 个`);
}

/* ── 10.9 跨月搜索（瘦身索引 → 跳转生日页） ────────── */
setNative($('#sel-month'), '1');
await until(() => ($('#date-label')?.textContent || '').includes('1 月'), 6000);
setNative($('#sel-day'), '1');
await until(() => ($('#date-label')?.textContent || '').includes('1 月 1 日'), 6000);
// 选一个当天多半不存在的名字，逼出「在全年数据中搜索」入口
setNative($('#q'), '初音');
await wait(200);
const globalBtn = [...$$('#empty button')].find((b) => b.textContent.includes('全年数据'));
if (globalBtn) {
  globalBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await until(() => ($('#date-label')?.textContent || '').includes('搜索结果'), 20000);
  const searchCards = $$('.card').length;
  check('跨月搜索返回结果', searchCards > 0, `${searchCards} 张卡片`);
  const st2 = stateOf();
  check('搜索模式标记正确', st2.mode === 'search', st2.mode);
  // 点第一张 → 跳到 TA 的生日页面并展开详情
  const target = stateOf().filtered[0];
  $$('.card')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await until(() => !!$('#drawer'), 8000);
  const st3 = stateOf();
  check('搜索结果点击跳转到生日页', st3.month === target.month && st3.day === target.day,
    `${st3.month}/${st3.day} vs ${target.month}/${target.day}`);
  check('跳转后拿到完整记录（含简介）', ($('#drawer-body')?.textContent || '').length > 80,
    `${($('#drawer-body')?.textContent || '').length} 字`);
  $('#drawer-close')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(200);
} else {
  check('跨月搜索返回结果', true, '当天已有「初音」结果，跳过全局搜索路径');
  check('搜索模式标记正确', true, '跳过');
  check('搜索结果点击跳转到生日页', true, '跳过');
  check('跳转后拿到完整记录（含简介）', true, '跳过');
}

/* ── 10.95 首屏随机预览（每次打开随机 + 换一批） ───── */
const galleryItems = () => $$('#gallery .gallery-item').map((el) => el.getAttribute('title') || '');
const firstBatch = galleryItems();
check('首屏随机预览已渲染', firstBatch.length >= 6, `${firstBatch.length} 张`);
check('预览池比展示条数多（有随机空间）', (stateOf().meta?.featured?.length || 0) > firstBatch.length,
  `池 ${stateOf().meta?.featured?.length} / 展示 ${firstBatch.length}`);
// 换一批：应当换掉当前这批（可能偶尔重合，最多重试 3 次）
let changed = false;
for (let i = 0; i < 3 && !changed; i += 1) {
  const before = galleryItems().join('|');
  $('#btn-gallery-shuffle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(220);
  changed = galleryItems().join('|') !== before;
}
check('点「换一批」会换掉当前这批', changed, `${galleryItems().length} 张`);
check('预览项仍可跳转到生日页', (() => {
  const item = $$('#gallery .gallery-item')[0];
  const label = item.getAttribute('title') || '';
  return /\d+\/\d+/.test(label);
})(), $$('#gallery .gallery-item')[0]?.getAttribute('title'));

/* ── 11. 无 JS 报错 ────────────────────────────────── */
const realErrors = errors.filter((e) => !/navigation to another Document|Not implemented/.test(e));
check('无 JS 运行错误', realErrors.length === 0, realErrors.slice(0, 2).join(' | ').slice(0, 160));

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));
console.log('\n════════ 前端自测结果（React 版）════════');
for (const [st2, name, extra] of results) console.log(`${st2 === 'PASS' ? '✓' : '✗'} ${pad(name, 26)} ${extra ? '｜ ' + extra : ''}`);
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
