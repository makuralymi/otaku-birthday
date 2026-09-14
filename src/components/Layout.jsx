/* ============================================================
   Layout.jsx · 顶栏 / 关于 / 页脚 / 轻提示
   ============================================================ */

import { SRC_LABEL } from '../lib/data.js';

export function TopBar({ favCount, onOpenFav }) {
  return (
    <header className="topbar">
      <a className="brand" href="./">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-text">
          生诞绘卷
          <em>Birthday Palette</em>
        </span>
      </a>
      <nav className="nav">
        <a href="#results">查询</a>
        <a href="#calendar">全年分布</a>
        <button type="button" id="nav-fav" onClick={onOpenFav}>收藏 <b id="fav-count">{favCount}</b></button>
        <a href="#about">关于</a>
      </nav>
    </header>
  );
}

export function About({ meta }) {
  const total = meta?.total || 1;
  const rows = [
    ['anilist', '动画 / 漫画 / 轻小说角色与立绘', meta?.sources?.anilist || 0],
    ['vndb', '视觉小说（Galgame）角色与立绘', meta?.sources?.vndb || 0],
    ['bangumi', '中文名 / 中文简介 / 中文作品名补全', null],
  ];
  return (
    <section className="about" id="about">
      <h2 className="section-title">关于这份生日书</h2>
      <div className="about-grid">
        <article>
          <h3>数据来源</h3>
          <ul className="src-list">
            {rows.map(([key, desc, count]) => (
              <li key={key}>
                <span>
                  <b><a href={SRC_LABEL[key].url} target="_blank" rel="noopener noreferrer">{SRC_LABEL[key].name}</a></b>
                  <em>{desc}</em>
                </span>
                <span className="fine">{count ? <b>{Math.round((count / total) * 100)}%</b> : '已合并'}</span>
              </li>
            ))}
            <li>
              <span><b>条目总数</b></span>
              <span className="fine">{meta ? total.toLocaleString('zh-CN') : '—'}</span>
            </li>
          </ul>
          <p className="fine">
            角色生日、立绘与作品信息分别来自上述公开数据库，版权归原作者与各作品方所有。本站仅作个人查询展示，
            所有条目都保留原始链接，图片直接引用原站 CDN（不本地转存）。
          </p>
        </article>

        <article>
          <h3>立绘是怎么取色的</h3>
          <p>
            页面会在浏览器里对每张立绘的上半身做一次 k-means 取色，把主色整理成一组
            <b>纯色</b>：一张卡片底色、5 个色块、一个强调色 —— 全站不使用渐变，
            所有颜色都是可以直接铺满的实色，所以每个人的生日页面配色都不一样。
          </p>
          <p className="fine">
            取色回退链：内存缓存 → 本地缓存 → 实时 canvas 取色 → 数据集预计算色板 → 名字哈希生成。
          </p>
        </article>

        <article>
          <h3>立绘是怎么调取的</h3>
          <p>每条立绘都有多条线路，前一条失败自动换下一条，直到本地生成的纯色占位图：</p>
          <ol className="route-list">
            <li>本地图缓存（跑过 <code>cache_images.py</code> 才启用，离线也能看）</li>
            <li>原站 CDN（AniList / Bangumi / VNDB 直连）</li>
            <li>跨站备用：另一数据库里同一角色的立绘</li>
            <li>同内容镜像域名（如 VNDB 的 t. ↔ s.）</li>
            <li>第三方图片代理（可跨域、可缩放，仅在前面的线路都失败时使用）</li>
            <li>本地纯色占位图（永不失败）</li>
          </ol>
        </article>

        <article>
          <h3>自己更新数据</h3>
          <pre><code>{`python3 scripts/fetch_anilist.py
python3 scripts/fetch_vndb.py
python3 scripts/build_dataset.py
python3 scripts/enrich_bangumi.py   # 中文补全，可中断续跑
python3 scripts/flag_nsfw.py        # 可选：标记 R18
python3 scripts/build_dataset.py    # 合并后重新生成
python3 scripts/cache_images.py --limit 200   # 可选：本地图缓存`}</code></pre>
          <p className="fine">
            产物为 <code>public/data/months/01.csv … 12.csv</code>，可直接用 Excel 打开；
            前端是 Vite + React，<code>npm run dev</code> 开发、<code>npm run build</code> 产出 <code>dist/</code>。
          </p>
        </article>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <p>生诞绘卷 · 非商业同人项目 · 数据来自 AniList / Bangumi / VNDB · 角色与作品版权归各自权利人所有</p>
    </footer>
  );
}

export function Toast({ message }) {
  return <div className={`toast${message ? ' show' : ''}`} id="toast" role="status" aria-live="polite">{message}</div>;
}
