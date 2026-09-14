# tools · 自测脚本

站点本身是 React + Vite 应用；这里的东西只在开发 / 回归时用得到。

```bash
npm install
npm test          # 打测试包 + 跑 54 项 jsdom 断言
```

- `make-test-bundle.mjs`：用 esbuild 把 `src/main.jsx` 打成一个生产模式的 IIFE 包（jsdom 不支持 ESM）
- `site-test.mjs`：把真实 `index.html` 与 bundle 丢进 jsdom，配真实 `public/data/*.csv`，
  断言 54 项行为：下拉与人数、URL 同步、卡片渲染与纯色变量、日历 366 天、类型筛选、搜索空态、
  排序、详情抽屉（色板 / 作品 / 来源链接）、收藏写入 localStorage、导出 CSV、分享、日期跳转、
  立绘线路降级（origin → 跨站备用 → 镜像 → 代理 → 占位图）、分片 404 退回全量 CSV、无 JS 报错。

改前端后跑一遍，能挡住绝大多数回归。
