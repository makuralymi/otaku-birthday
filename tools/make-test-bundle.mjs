/* 打一个给 jsdom 用的 IIFE 包（生产模式、automatic JSX runtime） */
import { build } from 'esbuild';
import path from 'node:path';

const out = process.env.BUNDLE || '/tmp/otaku-birthday-app.bundle.js';
await build({
  entryPoints: [path.resolve(process.cwd(), 'src/main.jsx')],
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: out,
  logLevel: 'warning',
});
console.log('bundle →', out);
