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
npm test             # jsdom 自测：54 项断言
```

部署：`npm run build` 后把 `dist/` 丢给任意静态服务器（Nginx / GitHub Pages / Vercel 都行）。

## 数据管道

数据不是手工整理的，而是脚本抓取 → 合并 → 去重 → 补全后生成：

```bash
python3 scripts/fetch_anilist.py      # ① AniList：动画/漫画/轻小说角色（分页 + 热门作品 cast）
python3 scripts/fetch_vndb.py         # ② VNDB：GalGame / 视觉小说角色
python3 scripts/fetch_bangumi_dump.py # ③ Bangumi 官方全量 dump：GalGame + 二次元手游/主机游戏角色
python3 scripts/enrich_bangumi_ids.py # ④ 给上一步的角色补立绘与简介（按角色 id 直查，可中断续跑）
python3 scripts/build_dataset.py      # ⑤ 合并去重 → public/data/days/*.csv + search-index.csv + meta.json
python3 scripts/enrich_bangumi.py     # ⑥ Bangumi：补中文名 / 中文简介 / 中文作品名（可中断续跑）
python3 scripts/flag_nsfw.py          # ⑦ 可选：标记 R18 立绘（默认隐藏）
python3 scripts/build_dataset.py      # ⑧ 合并中文与标记后重新生成
python3 scripts/cache_images.py --limit 200   # ⑨ 可选：把热门立绘缓存到本地（离线可用）
python3 scripts/build_dataset.py --single     # 可选：额外出全量 characters.csv 与按月分片
```

| 脚本 | 数据源 | 说明 |
| --- | --- | --- |
| `fetch_anilist.py` | [AniList](https://anilist.co) GraphQL | 按收藏数分页扫描（上限 5000 条），再抓热门作品 cast 补配角 |
| `fetch_vndb.py` | [VNDB](https://vndb.org) kana API | 按 `birthday != null` 过滤，取角色与作品评分 |
| `fetch_bangumi_dump.py` | [Bangumi Archive](https://github.com/bangumi/Archive) 官方全量 dump | 一次下载拿到 22 万角色、68 万条目、11 万游戏条目；只导入「有游戏登场 + 有生日」的角色，infobox 里直接带中文名与生日，GalGame 用标签/游戏类型区分 |
| `enrich_bangumi_ids.py` | [Bangumi](https://bgm.tv) v0 API | 按角色 id 补立绘与简介（1 请求/角色，限速 1.05s，可中断续跑） |
| `build_dataset.py` | 本地 | 跨源去重（同名 + 同生日）、分类、热度、色板预计算、写 CSV 与统计 |
| `enrich_bangumi.py` | [Bangumi](https://bgm.tv) v0 API | 日文名检索 + 严格打分匹配，同作品只查一次，未命中的下次重试 |
| `flag_nsfw.py` | VNDB | 按图片 sexual/violence 标记打 R18 标 |
| `cache_images.py` | 各 CDN | 可选：下载最热门立绘到 `public/img/cache/`，前端会优先读本地 |

礼貌抓取：请求间隔 ≥1s，429/5xx 指数退避，原始数据以 JSONL 增量落盘（`raw/`），**随时可中断续传**。

### 当前数据集规模

| 指标 | 数值 |
| --- | --- |
| 收录角色 | **20,251** 位 |
| 生日覆盖 | 366 / 366 天（含 2 月 29 日），中位数 48 位/天，最多的一天 214 位 |
| 来源 | AniList 3,476 · VNDB 6,466 · Bangumi 10,309（跨源同名同生日已合并） |
| 类型 | Galgame 12,107 · 动画 6,718 · **游戏 5,669** · 漫画 3,918 · 轻小说 578 |
| 数据体积 | 366 个按天分片共 17.7 MB（单日最大 201 KB）+ 搜索索引 5.0 MB |
| 立绘 | 约一半有立绘（Bangumi 侧由 `enrich_bangumi_ids.py` 逐批补，其余走纯色占位卡） |

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

## 立绘是怎么调取的（多线路兜底）

按顺序尝试，任一条成功即停：

| # | 线路 | 说明 |
| --- | --- | --- |
| ① | 本地缓存 | 跑过 `cache_images.py` 才启用；离线 / CDN 全挂也能看图 |
| ② | 原站 CDN | AniList / Bangumi / VNDB 直连，画质与出处最可信 |
| ③ | 跨站备用 | 数据里 `alts` 列：另一数据库里同一角色的立绘（不同域名） |
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

54 项断言覆盖：下拉与人数、URL 同步、卡片渲染与纯色变量、日历 366 天纯色分级、类型筛选、
搜索空态、排序、详情抽屉（色板 / 作品 / 来源链接）、收藏写入 localStorage、导出 CSV、分享、
日期跳转、**选择器（选月/选日立即生效且不被覆盖）**、R18 开关、页脚项目地址（含图标）、**立绘线路降级（origin → 备用 → 镜像 → 代理 → 占位图）**、**分片 404 退回全量 CSV**、无 JS 报错。

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
