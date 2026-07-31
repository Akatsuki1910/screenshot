import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { homepage?: string };

if (!pkg.homepage) {
  throw new Error('package.json に homepage がありません（更新チェックの配布元 URL に使います）');
}

/** 全ビルドで共有する設定 */
export const CHROME_TARGET = 'chrome109';

export const sharedDefine = {
  // 末尾スラッシュを保証しておく
  __UPDATE_BASE_URL__: JSON.stringify(pkg.homepage.replace(/\/*$/, '/'))
};
