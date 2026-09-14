import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯静态站点：数据放在 public/data 下，构建后直接丢到任意静态服务器即可
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    target: 'es2020',
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
});
