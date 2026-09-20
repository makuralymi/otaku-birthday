/* ============================================================
   Layout.jsx · 顶栏 / 关于 / 页脚 / 轻提示
   ============================================================ */

import { SRC_LABEL } from '../lib/data.js';
import { CLEAN_BUILD } from '../lib/buildflags.js';

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
  // 干净构建：不出现任何站外链接（数据源仍标注名称，符合署名要求）
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
                  <b>
                    {CLEAN_BUILD
                      ? SRC_LABEL[key].name
                      : <a href={SRC_LABEL[key].url} target="_blank" rel="noopener noreferrer">{SRC_LABEL[key].name}</a>}
                  </b>
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

/** 项目仓库地址（页脚展示） */
export const REPO_URL = 'https://github.com/makuralymi/otaku-birthday';

/** GitHub 图标：纯色填充，跟随 currentColor */
function GitHubIcon({ size = 17 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <p>生诞绘卷 · 非商业同人项目 · 数据来自 AniList / Bangumi / VNDB · 角色与作品版权归各自权利人所有</p>
      <a className="repo-link" id="repo-link" href={REPO_URL} target="_blank" rel="noopener noreferrer">
        <GitHubIcon />
        <span>项目地址</span>
      </a>
    </footer>
  );
}

export function Toast({ message }) {
  return <div className={`toast${message ? ' show' : ''}`} id="toast" role="status" aria-live="polite">{message}</div>;
}
