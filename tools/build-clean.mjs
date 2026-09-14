/* 干净构建：无外链、无分享 → dist-clean/
   用法：npm run build:clean   （加 LOCAL_IMAGES_ONLY=1 连立绘也不用外站图）
*/
import { spawnSync } from 'node:child_process';

const env = { ...process.env, CLEAN: '1' };
const args = ['vite', 'build'];
console.log(`干净构建中${env.LOCAL_IMAGES_ONLY === '1' ? '（不含任何外部图片请求）' : ''}…`);
const r = spawnSync('npx', args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
