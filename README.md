# 生诞绘卷 · Birthday Palette

> 输入你的生日，看看有哪些二次元角色与你同一天出生。
> **React + Vite** 前端，立绘实时取色成一组**纯色**，页面主色随角色变化 —— 全站不使用渐变。

---

## 它是什么

一个生日查询站：数据预先从 AniList / VNDB 抓取、用 Bangumi 补全中文，落到 CSV；
前端会对着每张立绘的上半身做一次 k-means 取色，把主色整理成一组**可以直接铺满的实色**
（底色、5 个色块、强调色、文字色），再驱动卡片、色块带、日历热力图与详情页。
**没有任何渐变、模糊与毛玻璃**，只有纯色块与 1px 描边。

- 🎂 **月/日选择器**：每个日期后直接显示当天角色数，**选完立即查询**（不需要再点按钮）
- 🛡 **图源大陆优先**：构建时按「国内可直连」排序（Bangumi / 萌百 / bwiki 优先），并可对缺失大陆图的条目定向补图
- 🎬 **开屏动画**：居中浮出「日期 + 站点标题」→ 停留 1 秒 → 上移落到主页面标题位置 → 其余内容依次渐显（`prefers-reduced-motion` 下自动跳过）
- 🌊 **无级平滑滚动（阻尼 + 惯性）**：主页面接管滚轮，把每一格输入平滑成一段「起步柔和 → 加速 → 柔和减速」的连续滑行（一格约 120px、约 300ms 滑完），连续几格会叠成一段长滑行；跟随即为临界阻尼（不回弹），另加滞后上限保证快速连滚不脱节。只有**到顶/到底**才出现橡皮筋拉扯与松手回弹。抽屉等内部滚动区一律交还原生滚动。参数在 `src/lib/scrollSmooth.js` 顶部（`OMEGA` / `MAX_LAG` / `LINE_PX` / `MAX_RUBBER`）
- 🃏 **卡片浮出**：`class="grid"` 里的卡片滚进视口才浮现，且**同一行从左到右逐格出现**（延迟 = 列索引 × 80ms，列数按响应式网格实测）；没滚到的部分保持隐藏
- 🎲 **首屏随机预览**：从 96 条候选池里每次随机抽 24 条展示（每次刷新都不一样），点「换一批」再抽一批（会避开当前这批）
- 🖼 **角色卡片**：立绘、中文名 / 日文原名 / 罗马音、登场作品、类型、人气
- 🎨 **莫奈取色（纯色版）**：卡片底色、色块条、日历分级、强调色全部来自立绘
- 🗓 **全年热力图**：366 天纯色块，一眼看出哪天生日的角色多，点击跳转
- 🔍 **筛选 / 排序 / 搜索**：类型筛选、人气/年份/名字排序、跨月全局搜索
- ⭐ **收藏夹**：localStorage 本地保存，可导出 CSV
- 📄 **CSV 数据**：按月分片（`public/data/months/MM.csv`），一键导出当前结果
- 🛣 **多线路兜底**：立绘六条线路依次降级，数据文件也有兜底（见下）
- ⌨️ 键盘可用（←/→ 换角色或换日期，Esc 关闭），尊重 `prefers-reduced-motion`
- 🔗 页脚带「项目地址」入口与 GitHub 图标

## 技术栈与命令

```bash
npm install          # 安装依赖（react / vite）
npm run dev          # 开发服务器 http://127.0.0.1:5173
npm run build        # 产出 dist/（含 public/ 下的数据与图片缓存）
npm run preview      # 本地预览构建产物 http://127.0.0.1:4173
npm test             # jsdom 自测：116 项断言
```

部署：`npm run build` 后把 `dist/` 丢给任意静态服务器（Nginx / GitHub Pages / Vercel 都行）。

## 三种构建变体

| 命令 | 产物 | 特点 |
| --- | --- | --- |
| `npm run build` | `dist/` | 常规版：带条目外链（AniList / Bangumi / VNDB / 萌百 / Google）、分享按钮、页脚项目地址 |
| `npm run build:clean` | `dist-clean/` | **无外链、无分享**：去掉全站所有站外链接与分享入口，数据源仍以文字署名（适合不允许外链的平台） |
| `LOCAL_IMAGES_ONLY=1 OUT_DIR=dist-clean-offline npm run build:clean` | `dist-clean-offline/` | 在上一档基础上**连立绘也不请求站外**：只用本地图缓存（`cache_images.py` 生成的 `img/cache/*`），没有缓存的角色显示纯色占位卡；`index.html` 里的 preconnect/dns-prefetch 也会被移除 |

干净档具体去掉了什么：

- 详情抽屉的「查看来源」外链区（AniList / Bangumi / VNDB / 萌娘百科搜索 / Google）
- 「关于」区数据源名称上的超链接（**名称保留**，署名不丢）
- 列表页的「分享」按钮、详情页的「复制分享链接」按钮
- 页脚的「项目地址」（GitHub 图标 + 链接）
- 站外图片请求（仅 `LOCAL_IMAGES_ONLY=1` 时；含首屏人气预览、收藏夹缩略图、抽屉大图）

自测覆盖两种模式：

```bash
npm test            # 常规档：116 项
CLEAN=1 npm test    # 干净档：114 项（断言「全站 0 个外链」「没有分享按钮」「仍标注数据源」等）
```

## 部署（Cloudflare Pages / Netlify / Vercel / Nginx）

**必须发布构建产物，不能直接发布仓库根目录**：浏览器不认 `.jsx`，直接发布源码目录会报

```
已拦截加载自 ".../src/main.jsx" 的模块，它使用了不允许的 MIME 类型（"text/jsx"）
```

Cloudflare Pages 设置（Settings → Build configuration）：

| 项 | 值 |
| --- | --- |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | 留空（或 `/`） |
| Node 版本 | 已用 `.nvmrc`（22）与 `package.json` 的 `engines.node`（>=20.19）声明，无需额外设置 |

其它平台同理：Netlify（build `npm run build` / publish `dist`）、Vercel（Framework 选 Vite，Output `dist`）、Nginx（`root /path/to/dist;`）。

仓库里已经放好这些部署相关文件：

- `wrangler.toml` —— `pages_build_output_dir = "dist"`，供 `npx wrangler pages deploy dist` 用
- `public/_headers` —— 构建时复制到 `dist/`：`/assets/*` 一年强缓存，`/data/days/*` 短缓存 + 正确的 `text/csv` 类型
- `public/data/**` —— 366 个按天分片 + 搜索索引（最大 214 KB/文件，远低于 CF Pages 单文件上限）

**误发根目录时不会白屏**：`index.html` 里加了自诊断，检测到 `/src/main.jsx` 加载失败会直接显示上面这段修复指引。

## 数据管道

数据不是手工整理的，而是脚本抓取 → 合并 → 去重 → 补全后生成：

```bash
python3 scripts/fetch_anilist.py      # ① AniList：动画/漫画/轻小说角色（分页 + 热门作品 cast）
python3 scripts/fetch_vndb.py         # ② VNDB：GalGame / 视觉小说角色
python3 scripts/fetch_bangumi_dump.py # ③ Bangumi 官方全量 dump：GalGame + 二次元手游/主机游戏角色
python3 scripts/enrich_bangumi_ids.py # ④ 给上一步的角色补立绘与简介（按角色 id 直查，可中断续跑）
python3 scripts/fetch_extra_images.py # ⑤ 仍有缺图的角色：去萌娘百科 / Fandom / VNDB 找（可中断续跑）
python3 scripts/fetch_bwiki.py        # ⑤′ B 站 wiki：按分类枚举或按缺口点名，取生日 + 立绘
python3 scripts/build_dataset.py      # ⑥ 合并去重 → public/data/days/*.csv + search-index.csv + meta.json
python3 scripts/enrich_bangumi.py     # ⑦ Bangumi：补中文名 / 中文简介 / 中文作品名（可中断续跑）
python3 scripts/flag_nsfw.py          # ⑧ 可选：标记 R18 立绘（默认隐藏）
python3 scripts/build_dataset.py      # ⑨ 合并中文与标记后重新生成
python3 scripts/cache_images.py --limit 200   # ⑩ 可选：把热门立绘缓存到本地（离线可用）
python3 scripts/build_dataset.py --single     # 可选：额外出全量 characters.csv 与按月分片
```

| 脚本 | 数据源 | 说明 |
| --- | --- | --- |
| `fetch_anilist.py` | [AniList](https://anilist.co) GraphQL | 按收藏数分页扫描（上限 5000 条），再抓热门作品 cast 补配角 |
| `fetch_vndb.py` | [VNDB](https://vndb.org) kana API | 按 `birthday != null` 过滤，取角色与作品评分 |
| `fetch_bangumi_dump.py` | [Bangumi Archive](https://github.com/bangumi/Archive) 官方全量 dump | 一次下载拿到 22 万角色、68 万条目、11 万游戏条目；只导入「有游戏登场 + 有生日」的角色，infobox 里直接带中文名与生日，GalGame 用标签/游戏类型区分 |
| `enrich_bangumi_ids.py` | [Bangumi](https://bgm.tv) v0 API | 按角色 id 补立绘与简介（1 请求/角色，限速 1.05s，可中断续跑） |
| `fetch_extra_images.py` | [萌娘百科](https://zh.moegirl.org.cn) · [Fandom](https://www.fandom.com) · [VNDB](https://vndb.org) | 仍未补到立绘的角色按来源分层找图：萌百/Fandom 用 `prop=pageimages` 批量问，VNDB 按名字搜索并校验生日一致 |
| `fetch_bwiki.py` | [B 站 wiki](https://wiki.biligame.com) | 国内主流二游的 wiki：按角色分类枚举或按缺口点名，抽取生日 + 立绘（原图换成 400/800px 缩略图） |
| `parallel.py` | — | 线程池 + **按站点令牌桶限速**：并发不猛冲，不同站点各自限速可同时跑 |
| `build_dataset.py` | 本地 | 跨源去重（同名 + 同生日）、分类、热度、色板预计算、写 CSV 与统计 |
| `enrich_bangumi.py` | [Bangumi](https://bgm.tv) v0 API | 日文名检索 + 严格打分匹配，同作品只查一次，未命中的下次重试 |
| `flag_nsfw.py` | VNDB | 按图片 sexual/violence 标记打 R18 标 |
| `cache_images.py` | 各 CDN | 可选：下载最热门立绘到 `public/img/cache/`，前端会优先读本地 |

礼貌抓取：请求间隔 ≥1s，429/5xx 指数退避，原始数据以 JSONL 增量落盘（`raw/`），**随时可中断续传**。

### 当前数据集规模

| 指标 | 数值 |
| --- | --- |
| 收录角色 | **20,199** 位 |
| 生日覆盖 | 366 / 366 天（含 2 月 29 日），中位数 48 位/天，最多的一天 214 位 |
| 来源 | AniList 3,476 · VNDB 6,466 · Bangumi 10,309（跨源同名同生日已合并） |
| 类型 | Galgame 12,107 · 动画 6,718 · **游戏 5,669** · 漫画 3,918 · 轻小说 578 |
| 数据体积 | 366 个按天分片共 17.7 MB（单日最大 201 KB）+ 搜索索引 5.0 MB |
| 立绘 | **99.6%**（20,125/20,199）；其中 **93.2% 的主图在大陆可直连图源**（Bangumi 18,773 · VNDB 1,084 · AniList 209 · 萌百 59） |

### 数据格式

`public/data/days/0101.csv … 1231.csv`（按天分片，一次查询只加载当天那几十 KB）；
`public/data/search-index.csv` 是瘦身索引（无简介/作品明细），用于跨月搜索与分片兜底；
需要单文件全量时执行 `python3 scripts/build_dataset.py --single` 生成 `characters.csv` 与按月分片。

| 列 | 含义 |
| --- | --- |
| `id` / `src` | 主键（`al45627`、`vndb-c2`）与主数据源 |
| `month` / `day` / `year` | 生日 |
| `name_cn` / `name_native` / `name_romaji` / `alt_names` | 中文名 / 日文原名 / 罗马音 / 别名 |
| `gender` / `blood` / `age` | 性别 / 血型 / 年龄 |
| `types` / `ptype` | 全部作品类型（`\|` 分隔）与主类型 |
| `work` / `work_cn` / `work_year` / `works` | 主作品与其年份；`works` 为 JSON 数组 |
| `summary` | 简介（中文优先，回退英文） |
| `heat` / `fav` / `votes` / `collects` | 热度及 AniList 收藏 / VNDB 投票 / Bangumi 收藏 |
| `nsfw` | R18 标记（默认隐藏，可开关） |
| `image` / `thumb` | 大图 / 缩略图 |
| `alts` | **跨站备用图源**（另一数据库的同一角色立绘，`\|` 分隔） |
| `palette` | 构建期预计算色板（给不允许跨域取色的图源兜底） |
| `url_al` / `url_bgm` / `url_vndb` / `bgm_id` | 原始条目链接 |

## 立绘缺口是怎么补的（多源找图）

Bangumi 的全量 dump 只有文字没有图片地址，所以有约 1 万条角色一开始没有立绘。补图按「准确度 vs 成本」分层：

| 顺序 | 来源 | 方式 | 单请求覆盖 | 说明 |
| --- | --- | --- | --- | --- |
| ① | Bangumi v0 API（按角色 id） | `GET /v0/characters/{id}` | 1 个角色 | 最权威（图 + 简介），限速 1.05s，`enrich_bangumi_ids.py` 后台逐批跑 |
| ② | 萌娘百科 | `prop=pageimages`（页面主图） | **50 个标题** | 角色页主图通常就是立绘；图片在 `storage.moegirl.org.cn`，可热链且带 CORS，浏览器能直接取色 |
| ③ | Fandom | `prop=pageimages`（按作品映射到对应 wiki） | **50 个标题** | 用罗马音/英文标题检索，过滤 icon/card 类图；`static.wikia.nocookie.net` 要求带 Referer，前端对 `nocookie.net` 单独改用 `origin-when-cross-origin` |
| ④ | VNDB | 按名字搜索 + **校验生日一致** | 1 个角色 | GalGame 侧最准，命中才采用 |
| ⑤ | B 站 wiki（bwiki） | 分类枚举 / 缺口点名 + `action=parse` | 1 个角色 | 国内二游 wiki，同时提供生日与立绘；图片同样可热链、带 CORS |

所有来源的结果都会写进同一个 `raw/images_extra.jsonl`，构建时：**主图空缺就补上，已有图则排进 `alts` 备用线路** ——
所以前端那套「六条线路依次降级」对每个角色都成立。

**并发模型**：抓取一律走 `scripts/parallel.py` —— 线程池负责并发，令牌桶（`RateLimiter`）保证每个站点的平均请求速率上限并加抖动，
失败自动退避；不同站点互相独立可同时跑。默认值：Bangumi 4 req/s、萌百 3 req/s、Fandom 4 req/s（可用 `--workers/--rps` 调整）。
所有脚本都「边跑边落盘」，随时中断续跑。

## 数据是怎么去重的

跨源（AniList / VNDB / Bangumi）与源内都会去重，判据是**「同名 + 同生日」**：

1. **名字取并集**：日文原名 / 罗马音 / 中文名任一写法相同即命中（修掉了「只比第一个字段」的漏合并）
2. **书写归一**：繁→简单字表（Vendored [OpenCC `TSCharacters`](https://github.com/BYVoid/OpenCC)，Apache-2.0，见 `scripts/data/ts_characters.txt`）、
   小写化、去中点/空格/标点、`ヶ/ヵ` 省略差异（桐ヶ谷和人 ↔ 桐谷和人）
3. **合并而非丢弃**：两边的作品、类型、立绘、别名、热度取并集，中文简介优先
4. **两轮执行**：第一轮在载入原始数据后，第二轮在 Bangumi 中文补全之后（AniList/VNDB 记录的中文名往往这时才填上，
   而「中文名相同 + 同生日」正是跨源重复最明显的信号）
5. Bangumi dump 内部同样先按「主名 / 中文名 / 日文名」去重（别名不参与 key，避免「爱丽丝」「レイ」这类重名误合并）

当前全库自检：**同名 + 同生日的残留重复 = 0 对 / 20,251 条**。

## 图源的大陆可用性（默认「大陆优先」）

本站用户主要在大陆，而不同图源的可达性差别很大，所以构建时会把**国内可直连的图源排在前面**：

| 图源 | 域名 | 大陆直连 | 备注 |
| --- | --- | --- | --- |
| Bangumi | `lain.bgm.tv` | ✅ 可直连 | 主力图源，覆盖率最高 |
| 萌娘百科 | `storage.moegirl.org.cn` | ✅ 可直连 | 带 CORS，浏览器能直接取色 |
| B 站 wiki | `patchwiki.biligame.com` | ✅ 可直连 | 主流二游角色 |
| AniList | `s4.anilist.co` | ⚠️ 常打不开/很慢 | 作为备选排在后面 |
| VNDB | `t.vndb.org` | ⚠️ 常打不开/很慢 | 同上（另有 `s.vndb.org` 镜像） |
| Fandom | `static.wikia.nocookie.net` | ❌ 基本不可达 | 仅作最后备选 |
| 第三方代理 | `i0.wp.com` / `wsrv.nl` | ⚠️ 视网络而定 | 仅在图源失败时兜底 |

**构建期排序**（`scripts/build_dataset.py`，可用 `CN_FIRST=0` 关闭）：把所有候选图按「国内可直连优先」排序，
第一张作卡片主图、同图源的更大尺寸作详情大图，其余进 `alts` 备用线路。这样同一份数据在不同网络下都能拿到图：

- 大陆：直接用 `lain.bgm.tv` / 萌百 / bwiki（首轮就能显示）
- 海外：若首选失败，前端会自动降级到 AniList / VNDB / 代理

**给缺大陆图的角色补图**（`scripts/enrich_bangumi.py --cn-images`）：扫描数据集中「主图不可直连且没有大陆备用图」
的条目，按人气并发去 Bangumi 检索同一角色的图（写入 `alt_images`，构建时自动提为主图）。
后续还可接萌百 / bwiki 作为二级来源。

## 立绘是怎么调取的（多线路兜底）

按顺序尝试，任一条成功即停：

| # | 线路 | 说明 |
| --- | --- | --- |
| ① | 本地缓存 | 跑过 `cache_images.py` 才启用；离线 / CDN 全挂也能看图 |
| ② | 原站 CDN | AniList / Bangumi / VNDB 直连，画质与出处最可信 |
| ③ | 跨站备用 | 数据里 `alts` 列：另一数据库 / 其它站点（萌娘百科、Fandom、VNDB）里同一角色的立绘 |
| ④ | 同内容镜像 | 如 VNDB `t.vndb.org ↔ s.vndb.org`，换域名不换内容 |
| ⑤ | 第三方代理 | `i0.wp.com` / `wsrv.nl`，可跨域、可缩放；**仅在前四条都失败时使用** |
| ⑥ | 本地占位图 | 用角色自己的色板现画一张纯色 SVG，零网络、永不失败 |

前端每次换线路都会重新判断「这张图能不能读画布」：能读就实时取色，不能读就用 CSV 里的预计算色板。
所有线路都写在 `src/lib/config.js` 里，**把 `proxies` 置为空数组即可完全关闭第三方线路**。

数据文件同样有兜底：`meta.json` 挂了就用搜索索引现算统计；某天的分片 404 就退回搜索索引渲染（少简介与作品明细，卡片照常显示）。

## 项目结构

```
index.html                Vite 入口（含 SEO / 预连接）
src/main.jsx              React 挂载
src/App.jsx               状态编排：日期、筛选、抽屉、收藏、URL 同步
src/styles.css            设计系统（纯色；禁止渐变与模糊）
src/components/           Hero / Results / Calendar / Drawers / Layout
src/lib/palette.js        取色引擎 → 纯色方案（底色/色块/强调色/文字色）
src/lib/images.js         立绘多线路与兜底
src/lib/data.js           多线路取数 + CSV 归一化
src/lib/csv.js            零依赖 CSV 解析 / 导出
public/data/              数据集（CSV + meta.json）
scripts/                  Python 抓取与构建脚本
tools/site-test.mjs       jsdom 自测
```

## 自测

```bash
npm install
npx esbuild src/main.jsx --bundle --format=iife --jsx=automatic \
  --define:process.env.NODE_ENV='"production"' --outfile=/tmp/otaku-birthday-app.bundle.js
node tools/site-test.mjs
```

116 项断言覆盖：下拉与人数、URL 同步、卡片渲染与纯色变量、日历 366 天纯色分级、类型筛选、
搜索空态、排序、详情抽屉（色板 / 作品 / 来源链接）、收藏写入 localStorage、导出 CSV、分享、
日期跳转、**选择器（选月/选日立即生效且不被覆盖）**、R18 开关、页脚项目地址（含图标）、**立绘线路降级（origin → 备用 → 镜像 → 代理 → 占位图）**、**分片 404 退回全量 CSV**、
**开屏交接受回归保护（淡出阶段必须继续匹配归位 transform；开屏背景与文字分层、标题文字零透明度过渡、主页面标题为交接帧硬切换）**、
**滚动方案受回归保护（不得出现 wheel 劫持与 preventDefault、旧的 smoothScroll/scrollDamping 模块必须已删除、必须是「速度滑窗 + ω/ζ 弹簧阻尼 + 偏移上限 + 静止阈值」、减少动效/触摸设备自动跳过）**、
**`.page` 容器边界（顶栏 / 开屏 / 抽屉等 fixed 元素必须在容器外，避免被阻尼 transform 污染）**、
**抽屉面板带 `data-native-scroll` 原生滚动标记**、**取色色条逐块浮现（`--i` 递增延迟，且作用域不含抽屉色板）**、**卡片浮出（按列延迟左→右、等开屏交接后才播、列数实测）**、**抽屉开关的 Q 弹动效（closing 态先播退场再卸载、退场时长 JS 与 CSS 一致、移动端 Y 轴版本）**、无 JS 报错。

动效本身（对位误差、交叉淡入、阻尼曲线）在无头 Firefox 里用真实浏览器探针回归，见下节。

## 动效与滚动（实现取舍）

### 开屏动画 → 主页面（无缝交接）

流程：居中浮出「日期 + 标题」→ 停留 1s → 上移缩放到主页面标题位置 → 开屏背景层渐隐 → 其余内容依次渐显。

**标题文字（「你的生日里，住着哪些角色？」）全程 `opacity: 1`，不参与任何淡入淡出**：
`.intro` 分成两层 —— `.intro-bg` 只负责「遮住页面 → 渐隐」（页面其余内容随它逐层浮现），
标题文字在它之上，只位移/缩放；对齐后用 `body.intro-handoff` 在同一帧把开屏图层移除、把主页面
标题点亮（`body:not(.intro-handoff) .hero-title{opacity:0}` → `body.intro-handoff .hero-title{opacity:1}`，
两边都没有 transition），因为两段文字位置/字号/颜色完全一致，这一步是「无缝硬切换」，中间不存在淡入淡出。

关键点：

- 两边都把标题文字包在 `inline-block` span 里量 `getBoundingClientRect()`（inline 块的矩形就是文字边界），
  开屏用 `transform-origin: top left` + `translate3d(dx,dy) scale(to.width/from.width)` 精确映射到主标题上；
- **缩放比按文字宽度算**，不能按高度（开屏行高来自 body 的 1.65，主标题是 1.18，高度比会算错）；
- 垂直方向对齐**中心线**，让行高差异被半行距对称吸收；
- `.hero-title` 在未就绪态**只淡出不位移**：早前它带 `translateY(16px)`，导致量到的目标位置偏 16px，交接时回弹；
- 归位 transform 必须**同时匹配 `intro-move` 与 `intro-fade`**：只在 move 阶段生效的话，进入淡出的瞬间规则失效，
  文字会在 240ms 淡出里反向滑回中心（实测偏移 16.6px / 6.5px，就是「过渡不无缝」的根因）；
- 其余内容（lede / picker / 色带 / gallery / 结果区 …）由 `body.page-ready` 触发，按 0.14s → 0.36s 的延迟依次渐显。

无头 Firefox 探针实测（1280×820，iframe 内真实渲染）：

| 指标 | 结果 |
| --- | --- |
| 淡出期间文字左边缘偏差 dx | **0.0px**（共 8 帧采样） |
| 淡出期间中心线偏差 dy | **0.0px** |
| 淡出期间文字宽度差 | **0.0px** |
| 开屏与主标题「同时半透明」帧数 | **10 帧**（交叉淡入无缝） |
| 开屏元素自动移除 / `body.page-ready` | ✓ / ✓ |
| 开屏标题文字 opacity（151 帧采样） | **恒为 1.000**（无淡入） |
| 主页面标题处于中间透明度的帧数 | **0 帧**（硬切换，无淡出/淡入） |
| 标题可见性断档帧数 | **0 帧**（交接无空档） |
| 背景层 `.intro-bg` 渐隐中间帧 | 12 帧（其余内容仍逐层浮现） |
| 交接两端样式 | `rgb(25,24,32)` / w600 / Songti SC，缩放后 **46.0px = 主页面 46.0px** |

### 取色色条：开屏结束后「依次浮现」

`.colorband` 不再整条一起淡入 —— 整条太「齐」，改成每块自己浮现：

- `PaletteBlocks` 给每个色块注入 `--i`（索引）；
- `body.page-ready` 之后每块执行 `swatch-in`（`opacity 0 → 1` + `translateY(6px → 0)`，420ms），
  `animation-delay: calc(.34s + var(--i) * 70ms)`，`fill-mode: both` 保证轮到之前一直保持隐藏；
- 隐藏初值只作用于 `.colorband .palette-blocks span` 与首屏 `.hero-blocks span`，
  **抽屉里的色板（`.drawer .palette-blocks`）不受影响**；减少动效时关闭动画并直接可见。

实测（无头 Firefox，逐帧采样，时间相对开屏交接）：

| 指标 | 结果 |
| --- | --- |
| 5 块出现时刻 | 386 / 439 / 506 / 590 / 657 ms |
| 相邻间隔 | 53 / 67 / 84 / 67 ms（设计值 70ms） |
| 首块出现 | 开屏交接后 **386ms**（动画结束后才开始） |
| 整条铺满跨度 | 271ms |
| 开屏期间色块 | 全部 opacity 0（不提前露头） |
| 抽屉内色板 | 始终 opacity 1（不参与） |

### 抽屉开关：Q弹（弹簧过冲）

侧栏（`class="drawer-panel"`）原来没有任何开关动画，现在：

- **进场**：`@keyframes drawer-in` —— 从屏外滑入 → 冲过静止位 ~16px（并轻微挤压 `scaleX(1.014)`）→ 小回弹 → 稳定，
  `transform-origin` 放在贴边那一侧，挤压像「果冻贴在边」；内部内容随后 0.07s 淡入上浮；
- **退场**：`@keyframes drawer-out` —— 先**反向蓄力**（往回顶 13px）→ 甩出并压扁（`scaleX(.94)`）；
- 退场需要元素先别卸载，所以新增 `useSpringClose`：关闭时先加 `.closing` 播 300ms 退场动画，动画结束才真正 `onClose()`；
- **× 按钮 / 遮罩 / ESC / 收藏夹里点某条**都走这条路径（点收藏条时先播退场再跳转）；
  App 在有抽屉打开时不再抢 ESC，交给抽屉自己处理；开启减少动效时直接关，不做延迟；
- 移动端（≤560px，底部抽屉）用 `drawer-in-mobile` / `drawer-out-mobile`，同样的 Q 弹换成 Y 轴；
- 换角色时面板带 `key={char.id}` 重新挂载 → 弹簧再弹一次，同时滚动位置回到顶部。

无头 Firefox 探针实测（面板静止位 left=816）：

| 场景 | 结果 |
| --- | --- |
| 进场轨迹 | `1313（屏外）→ 875 → **807**（冲过静止位 22px）→ 816 稳定` |
| 退场轨迹 | `809 → **800**（反向蓄力 16px）→ 856 → 1288（甩出视口）→ 卸载` |
| 收藏抽屉（宽 560） | `1324 → 最左 684（过冲 24px）→ 708 稳定` |
| ESC 关闭 | 同样先 `.closing`，动画结束再卸载 |
| 退场时长一致性 | JS `DRAWER_EXIT_MS=300` == CSS `.3s`（避免动画中途卸载） |
| 回归 | 抽屉内滚轮未被 `preventDefault`、`data-native-scroll` 保留、页面滚动弹簧正常 |

### 卡片浮出：滚到哪里，哪里从左到右逐格浮现

`class="grid"` 的卡片原来是「进视口加 `.is-in` + 按 `index % 12` 给延迟」，但 CSS 里**根本没有对应的动画规则**
（`--reveal-delay` 也没有任何规则使用）—— 这段浮出动画一直是哑的。现在重做：

- 卡片默认 `opacity: 0; transform: translateY(14px)`，滚进视口（IntersectionObserver，触发线在视口底部上方 10%）
  才加 `.is-in` 开始浮现 → **滚到哪里，哪里才出现**；
- 延迟按**列索引**算：`--reveal-delay = (index % 列数) × 80ms`，所以每一行都是**左边先出、右边依次跟上**；
- 列数由网格实测（`getComputedStyle(grid).gridTemplateColumns` 的轨道数 + `ResizeObserver`），
  `repeat(auto-fill, …)` 换列数时延迟自动重算；
- 整段动画挂在 `body.intro-handoff` 上：必须等开屏交接完成才播，否则首屏那几行的错峰会被开屏盖住看不见；
- 减少动效时（全局规则）直接可见。

顺手修掉另一个同类哑动画：`.gallery-item` 引用了 `@keyframes rise`，但文件里没有这个关键帧（预览项的入场动画一直没生效），已补上。

无头 Firefox 探针实测（视口 1268×820，实测 5 列）：

| 场景 | 结果 |
| --- | --- |
| 每行延迟 | `0 / 80 / 160 / 240 / 320 ms`（第二行同样是这个序列） |
| 第一行出现时刻 | 431 / 512 / 585 / 675 / 753 ms（间隔 73~90ms，严格左→右） |
| 第二行出现时刻 | 539 / 636 / 713 / 791 / 870 ms（间隔 77~97ms） |
| 折叠线以下 | 5/5 仍 `opacity: 0`（网格顶部 1093px > 视口 820px） |
| 滚到更下方 | 那一行才出现：483 / 546 / 634 / 720 / 798 ms（间隔 63~88ms） |
| 浮现完成 | `opacity: 1` |

### 主页面滚动：无级平滑 + 只在上下边缘回弹（`src/lib/scrollSmooth.js`）

历史上试过三条错路，都已删除：① 劫持滚轮但没有放过抽屉内部滚动；② 位置滞后 lerp（滞后随累计距离增长）；
③ 速度驱动的弹簧偏移 —— 它会在**每一次**停手时都回弹一点，方向就错了。

现在的目标与实现：

- **无级平滑（阻尼 + 惯性）**：主页面接管 `wheel`（`preventDefault` 后由自己逐帧驱动），
  跟随用**临界阻尼**系统 `a = ω²(target−cur) − 2ω·vCur`（ζ=1）：从速度为 0 起步（无突跳）→ 加速 → 柔和减速贴合，
  **一格约 300ms 滑完**，连续几格自然叠成一段长滑行；`OMEGA=20` 决定黏度（越小越柔、惯性越久）；
- 每格距离归一化：Firefox 一格是「3 行」（`deltaMode=1`），按 `LINE_PX=40` 换算成 **约 120px**，
  与 Chrome 的 ~100px/格 对齐（否则 Firefox 一格只走 48px，看起来更像一格一格跳）；
- `MAX_LAG=150px`：快速连滚时最多落后 1.2 格左右，超过就加快追随 —— 既保留惯性手感，又不会越拖越远；
- **平时不回弹**：中部的滚动阶段 `.page` 上没有任何 transform，停手后精确停在输入总量上（实测冲过量 0px）；
- **只有到顶/到底才回弹**：越界的那部分输入变成橡皮筋拉扯（阻尼 0.45、上限 132px），
  松手 90ms 后用欠阻尼弹簧弹回 0 —— 这是唯一会出现回弹的地方；
- **抽屉等内部滚动区一律放行**：wheel 若发生在任何可滚动祖先里（`.drawer-panel` / `.drawer-body`、
  带 `data-native-scroll` 的元素、其它滚动条），完全不接管，交还浏览器原生滚动；
- **键盘 / 滚动条拖动 / 锚点 / `scrollIntoView` 不拦**：它们改变 `scrollY` 后由 `scroll` 监听自动同步；
- 逐帧用 `scrollTo({ behavior: 'instant' })` 写位置，避免与 CSS 的 `scroll-behavior: smooth` 叠加成双倍动画；
- 触摸为主或 `prefers-reduced-motion` → 不接管，保持原生滚动。

无头 Firefox 探针实测：

| 场景 | 结果 |
| --- | --- |
| 单格滚轮（deltaY=120） | `0 → 14 → 44 → 69 → 87 → 98 → 111 → 115 → 118 → 120`，**26 帧中间态**、457ms 内完全贴合（可见滑行约 250ms） |
| 行模式（Firefox 一格 3 行） | 归一化为 **120px** |
| 连续三格 | 总位移 360px（精确）、冲过量 **0px**、滞后峰值 122px（受 `MAX_LAG=150` 约束） |
| 位移准确性 | 输入 120px → 滚 120px（不双倍） |
| 中部：整体位移 | `.page` 的 transform 始终为空（无橡皮筋） |
| 中部：是否冲过头 | 收尾 `779 → 840`（输入总量 840），**冲过量 0px**，500ms 后仍是 840 |
| 底部橡皮筋 | `-54 → -108 → -132`（上限）；松手 `-132 → +29 → 0`；`scrollY` 保持不变 |
| 顶部橡皮筋 | `+68`；松手最低 `-16` → 0；回弹后 `scrollY = 0` |
| 键盘 / 滚动条式跳转 | `scrollTo(0,400)` 立即生效、无残留 transform |
| 抽屉内滚轮 | `defaultPrevented = false`（原生滚动），Δpage = 0.0 |

### 三种构建都验证过

- `dist/`：常规档，`npm test` **85/85**；
- `dist-clean/`：无外链无分享档，`CLEAN=1 npm test` **83/83**；
- `dist-clean-offline/`：真实浏览器里全程操作（滚动 + 换一批 + 开抽屉）后
  `performance.getEntriesByType('resource')` 只有 **5 个同源请求、0 个外部请求**，182 张 `<img>` 无一个站外 src、
  0 张裂图，页面无任何站外 `<a href>`，同时仍保留 AniList / Bangumi 文字署名。

## 常见问题

**为什么有的角色只有日文名 / 罗马音？**
中文名来自 Bangumi，需要逐个角色检索（约 2 秒一个，避免打扰对方服务器），所以按人气从高到低分批补：

```bash
BANGUMI_LIMIT=4000 python3 scripts/enrich_bangumi.py   # 可反复执行，已命中的不会重复请求
python3 scripts/build_dataset.py
```

**为什么默认看不到某些角色？** GalGame 里有一部分立绘属于 R18，`flag_nsfw.py` 会打标，默认过滤。

**生日分布不均？** 7 月 7 日（七夕）、3 月 3 日、12 月 25 日这类日子设定特别多，日历热力图就是拿来看这件事的。

**2 月 29 日？** 照常可查；数据里出现过「2 月 30 日」的愚人节角色，构建时会被丢弃。

**为什么没有渐变？** 设计上刻意只用纯色块：颜色全部来自取色结果本身，深浅变化靠并置的纯色块而不是渐变过渡。

## 版权与免责

- 角色生日、立绘、简介、作品信息版权归原作者与各作品方所有；本站是非商业同人项目，仅做数据聚合展示，
  所有条目保留原始链接，**图片默认直接引用原站 CDN，不做本地转存**（本地缓存脚本需自行决定是否启用）。
- 数据来自 [AniList](https://anilist.co)、[VNDB](https://vndb.org)、[Bangumi](https://bgm.tv)，
  使用时请一并遵守各自的服务条款与 API 规范。
- 第三方图片代理仅在兜底时启用，可一键关闭。
