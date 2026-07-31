/**
 * GitHub Pages 用の配布サイトを _site/ に生成する。
 *   _site/index.html            site/index.html にビルド情報を埋め込んだもの
 *   _site/element-screenshot.zip  dist/ の中身を固めた zip（展開してそのまま読み込める）
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(root, '_site');
const zipName = 'element-screenshot.zip';

if (!existsSync(dist)) {
  console.error('dist/ がありません。先に `npm run build` を実行してください。');
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// dist の「中身」を固める。展開したフォルダをそのまま chrome://extensions で読み込める形にする
execFileSync('zip', ['-r', '-q', '-X', join(outDir, zipName), '.'], { cwd: dist });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const bytes = statSync(join(outDir, zipName)).size;

const git = (args, fallback) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
};

const repoUrl =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`
    : git(['remote', 'get-url', 'origin'], '').replace(/\.git$/, '') || '#';

const replacements = {
  VERSION: pkg.version,
  COMMIT: (process.env.GITHUB_SHA ?? git(['rev-parse', 'HEAD'], 'unknown')).slice(0, 7),
  DATE: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', timeStyle: 'short', dateStyle: 'medium' }),
  SIZE: `${(bytes / 1024).toFixed(0)} KB`,
  REPO_URL: repoUrl
};

let html = readFileSync(join(root, 'site', 'index.html'), 'utf8');
for (const [key, value] of Object.entries(replacements)) {
  html = html.replaceAll(`{{${key}}}`, value);
}

const unresolved = html.match(/\{\{[A-Z_]+\}\}/g);
if (unresolved) {
  console.error(`テンプレートの未置換があります: ${[...new Set(unresolved)].join(', ')}`);
  process.exit(1);
}

writeFileSync(join(outDir, 'index.html'), html);

// Pages が _ 始まりのパスを無視しないようにする
writeFileSync(join(outDir, '.nojekyll'), '');

// アイコンを favicon 代わりに置いておく
cpSync(join(dist, 'icons', 'icon128.png'), join(outDir, 'icon.png'));

console.log(`_site/ を生成しました（${zipName}: ${replacements.SIZE}, commit ${replacements.COMMIT}）`);
