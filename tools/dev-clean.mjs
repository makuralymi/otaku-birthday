/* 本地开发测试 clean 干净版本（无条目外链、无分享按钮，保留页脚 GitHub 链接）
   用法：npm run dev:clean
*/
import { spawn } from 'node:child_process';

const env = { ...process.env, CLEAN: '1' };
console.log('启动干净版本（CLEAN=1）本地开发服务器…');
const child = spawn('npx', ['vite', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
