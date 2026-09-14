/* 打一个给 jsdom 用的 IIFE 包（生产模式、automatic JSX runtime） */
import { build } from 'esbuild';
import path from 'node:path';

const clean = process.env.CLEAN === '1';
const out = process.env.BUNDLE || (clean ? '/tmp/otaku-birthday-clean.bundle.js' : '/tmp/otaku-birthday-app.bundle.js');
await build({
  entryPoints: [path.resolve(process.cwd(), 'src/main.jsx')],
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  target: 'es2020',
  define: {
    'process.env.NODE_ENV': '"production"',
    __CLEAN_BUILD__: clean ? 'true' : 'false',
    __LOCAL_IMAGES_ONLY__: process.env.LOCAL_IMAGES_ONLY === '1' ? 'true' : 'false',
  },
  outfile: out,
  logLevel: 'warning',
});
console.log('bundle →', out);
