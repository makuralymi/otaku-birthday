/* 本地测试 clean 干净版本
   用法：npm run test:clean
*/
import { spawnSync } from 'node:child_process';

const env = { ...process.env, CLEAN: '1' };
console.log('运行干净版本（CLEAN=1）自动化测试…');
const r1 = spawnSync('node', ['tools/make-test-bundle.mjs'], { stdio: 'inherit', env, shell: process.platform === 'win32' });
if (r1.status !== 0) process.exit(r1.status ?? 1);
const r2 = spawnSync('node', ['tools/site-test.mjs'], { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(r2.status ?? 1);
