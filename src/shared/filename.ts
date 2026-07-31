import type { ImageFormat } from './types';

const EXTENSIONS = /\.(png|jpe?g)$/i;

/**
 * ファイル名に使えない文字・ディレクトリ脱出につながる文字を除去する。
 * content script 側と service worker 側の両方で使う（後者は前者を信用しないため）。
 */
export function sanitizePart(value: string | undefined, fallback: string): string {
  const cleaned = String(value ?? '')
    // 制御文字
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.\.+/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  return cleaned || fallback;
}

/**
 * `folder/name.jpg` 形式のパスを安全な相対パスに正規化する。
 * 拡張子が無い／実データと食い違う場合は format に合わせて付け直す。
 */
export function sanitizeFilename(filename: string | undefined, format: ImageFormat): string {
  const ext = extensionFor(format);
  const fallback = `element-screenshot.${ext}`;

  const parts = String(filename ?? '')
    .split('/')
    .filter((p) => p !== '');
  if (parts.length === 0) return fallback;

  const name = sanitizePart(parts.pop(), fallback);
  const dirs = parts.map((p) => sanitizePart(p, 'element-screenshot')).filter(Boolean);
  const expected = format === 'png' ? /\.png$/i : /\.jpe?g$/i;
  const safeName = expected.test(name) ? name : `${name.replace(EXTENSIONS, '')}.${ext}`;
  return [...dirs, safeName].join('/');
}

export const pad = (n: number, width: number): string => String(n).padStart(width, '0');

export const extensionFor = (format: ImageFormat): string => (format === 'png' ? 'png' : 'jpg');

export const mimeFor = (format: ImageFormat): string =>
  format === 'png' ? 'image/png' : 'image/jpeg';
