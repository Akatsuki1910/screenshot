/**
 * ビルド成果物の健全性チェック。CI で壊れた dist をデプロイしてしまわないようにする。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const errors = [];
const check = (label, ok, detail = '') => {
  if (!ok) errors.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
};

// 1. manifest が参照するファイルが全て存在するか
const manifestPath = join(dist, 'manifest.json');
check('dist/manifest.json が存在する', existsSync(manifestPath));
if (!existsSync(manifestPath)) {
  console.error('\n' + errors.join('\n'));
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const referenced = [
  manifest.action.default_popup,
  manifest.background.service_worker,
  'content.js',
  'offscreen.html',
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon)
];

for (const file of [...new Set(referenced)]) {
  check(`参照ファイルが存在する: ${file}`, existsSync(join(dist, file)));
}

// 2. content script / service worker は self-contained な IIFE でなければならない
for (const file of ['content.js', 'background.js']) {
  const source = readFileSync(join(dist, file), 'utf8');
  check(`${file} に ESM の import/export が無い`, !/^\s*(import|export)\s/m.test(source));
  check(`${file} が空でない`, statSync(join(dist, file)).size > 500);
}

// 3. html2canvas が content.js に同梱されているか
const content = readFileSync(join(dist, 'content.js'), 'utf8');
check('content.js に html2canvas が同梱されている', content.includes('html2canvas'));

// 4. 拡張機能ページの参照パスが相対になっているか（chrome-extension:// で動かすため）
const popup = readFileSync(join(dist, 'popup.html'), 'utf8');
check('popup.html が相対パスで assets を参照している', /src="\.\/assets\//.test(popup));
check('popup.html が絶対パスを含まない', !/(src|href)="\//.test(popup));

// 5. バージョンが package.json と一致しているか
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
check(
  `manifest.json と package.json のバージョンが一致 (${manifest.version})`,
  manifest.version === pkg.version,
  `manifest=${manifest.version} package=${pkg.version}`
);

if (errors.length > 0) {
  console.error(`\n${errors.length} 件の問題:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('\ndist は正常です');
