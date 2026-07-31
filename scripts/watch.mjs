import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
rmSync(resolve(root, 'dist'), { recursive: true, force: true });

const configs = [null, 'vite.config.content.ts', 'vite.config.background.ts'];
const children = configs.map((config) => {
  const args = ['vite', 'build', '--watch'];
  if (config) args.push('-c', config);
  return spawn('npx', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
});

const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
