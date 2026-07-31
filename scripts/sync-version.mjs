/**
 * package.json の version を public/manifest.json に反映する。
 *
 * 更新チェックは manifest のバージョンと配布ページの version.json を比較するので、
 * 2 箇所を手で合わせるのは事故のもと。バージョンの正は package.json 側とする。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'public', 'manifest.json');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const raw = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(raw);

// manifest のバージョンは 1〜4 個のドット区切り整数でなければならない
if (!/^\d+(\.\d+){0,3}$/.test(pkg.version)) {
  console.error(
    `package.json の version "${pkg.version}" は manifest に使えません（1〜4 個のドット区切り整数のみ）`
  );
  process.exit(1);
}

if (manifest.version === pkg.version) {
  console.log(`manifest.json のバージョンは ${manifest.version} で同期済み`);
} else {
  const previous = manifest.version;
  manifest.version = pkg.version;
  // インデントと末尾改行は元のファイルに合わせる
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
  console.log(`manifest.json のバージョンを ${previous} → ${pkg.version} に更新しました`);
}
