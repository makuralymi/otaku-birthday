import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 干净构建（CLEAN=1）：
//   · 去掉所有指向站外的链接（条目外链、数据源链接、项目地址）
//   · 去掉分享功能（分享按钮、复制分享链接、复制色值的分享语义保留但不再有分享入口）
//   · 产物输出到 dist-clean/，与常规构建并存
// 可选：LOCAL_IMAGES_ONLY=1 时连立绘也不走外站（只用本地图缓存，其余用纯色占位卡）
const clean = process.env.CLEAN === '1';
const localImagesOnly = process.env.LOCAL_IMAGES_ONLY === '1';

// 离线变体：把 index.html 里的 preconnect / dns-prefetch 之类的站外提示也去掉，
// 保证页面**不会对任何站外域名发起请求**（图片走本地缓存或纯色占位图）。
function stripExternalHints() {
  return {
    name: 'strip-external-hints',
    transformIndexHtml(html) {
      return html
        .replace(/\s*<link rel="(?:preconnect|dns-prefetch)"[^>]*>/g, '')
        .replace(/<!--\s*立绘多线路：[^>]*-->\s*/g, '');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), ...(localImagesOnly ? [stripExternalHints()] : [])],
  define: {
    __CLEAN_BUILD__: JSON.stringify(clean),
    __LOCAL_IMAGES_ONLY__: JSON.stringify(localImagesOnly),
  },
  build: {
    // 可用 OUT_DIR 指定产物目录，方便同时产出多个变体
    outDir: process.env.OUT_DIR || (clean ? 'dist-clean' : 'dist'),
    assetsDir: 'assets',
    emptyOutDir: true,
    target: 'es2020',
  },
  server: { port: 5173, host: '127.0.0.1' },
});
