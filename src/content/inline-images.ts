/**
 * 別ドメインの画像を撮影できるようにする仕組み。
 *
 * html2canvas は canvas の汚染（tainting）を避けるため、CORS ヘッダの無い別オリジンの画像を
 * 描画しない。これが background-image が空白になる主な原因。
 *
 * そこで撮影前に service worker 経由で画像を取得して data URL 化し、
 * onclone の中で clone 側の background-image / img.src だけを差し替える。
 * 実際のページには一切影響を与えない。
 */

import type { FetchImagesMessage, FetchImagesResponse } from '../shared/types';

/** url(...) を拾う。CSS の複数背景にも対応するため global */
const CSS_URL_RE = /url\(\s*(['"]?)([^)'"]+?)\1\s*\)/g;

/** 画像を含みうる CSS プロパティ */
const IMAGE_PROPS = ['backgroundImage', 'borderImageSource', 'listStyleImage'] as const;

const PSEUDOS = ['::before', '::after'] as const;

/** 取得済み画像のキャッシュ（注入されている間ずっと保持）。成功したものだけ入れる */
const imageCache = new Map<string, string>();

function toAbsolute(url: string, base: string): string | null {
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

/** 拡張機能側で取りに行く必要がある URL か（別オリジンの http(s) だけ） */
function needsProxy(absUrl: string): boolean {
  if (absUrl.startsWith('data:') || absUrl.startsWith('blob:')) return false;
  try {
    const u = new URL(absUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return u.origin !== location.origin;
  } catch {
    return false;
  }
}

function collectFromCssValue(value: string, base: string, out: Set<string>): void {
  if (!value || value === 'none') return;
  for (const match of value.matchAll(CSS_URL_RE)) {
    const abs = toAbsolute(match[2] ?? '', base);
    if (abs && needsProxy(abs)) out.add(abs);
  }
}

function elementsOf(root: HTMLElement): HTMLElement[] {
  return [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
}

/** 対象要素以下で、拡張機能側から取得すべき画像 URL を集める */
export function collectExternalImageUrls(root: HTMLElement): string[] {
  const urls = new Set<string>();
  const base = document.baseURI;

  for (const node of elementsOf(root)) {
    if (node instanceof HTMLImageElement) {
      const src = node.currentSrc || node.src;
      const abs = src ? toAbsolute(src, base) : null;
      if (abs && needsProxy(abs)) urls.add(abs);
    }

    const cs = getComputedStyle(node);
    for (const prop of IMAGE_PROPS) collectFromCssValue(cs[prop], base, urls);
    for (const pseudo of PSEUDOS) {
      const pcs = getComputedStyle(node, pseudo);
      collectFromCssValue(pcs.backgroundImage, base, urls);
    }
  }

  return [...urls];
}

/** service worker に取得を依頼する（キャッシュ済みは除外） */
export async function resolveImages(urls: string[]): Promise<Map<string, string>> {
  const missing = urls.filter((u) => !imageCache.has(u));

  if (missing.length > 0) {
    try {
      const message: FetchImagesMessage = { type: 'FETCH_IMAGES', urls: missing };
      const res: FetchImagesResponse | undefined = await chrome.runtime.sendMessage(message);
      const images = res?.images ?? {};
      // 失敗はキャッシュしない（一時的なエラーや権限の付け直しで再試行できるように）
      for (const url of missing) {
        const dataUrl = images[url];
        if (dataUrl) imageCache.set(url, dataUrl);
      }
    } catch {
      /* 次回リトライする */
    }
  }

  const resolved = new Map<string, string>();
  for (const url of urls) {
    const dataUrl = imageCache.get(url);
    if (dataUrl) resolved.set(url, dataUrl);
  }
  return resolved;
}

/** CSS 値の中の url(...) を data URL に置き換える。置換が起きなければ null */
function rewriteCssValue(value: string, base: string, images: Map<string, string>): string | null {
  if (!value || value === 'none') return null;
  let changed = false;

  const next = value.replace(CSS_URL_RE, (whole, _quote: string, raw: string) => {
    const abs = toAbsolute(raw, base);
    const dataUrl = abs ? images.get(abs) : undefined;
    if (!dataUrl) return whole;
    changed = true;
    return `url("${dataUrl}")`;
  });

  return changed ? next : null;
}

/**
 * clone 側の画像参照を data URL に差し替える。
 *
 * 疑似要素は html2canvas が実要素（html2canvaspseudoelement）に展開し、
 * computed style を inline style としてコピーしてくれる。
 * その要素も clone のツリーに含まれるので、下の IMAGE_PROPS のループで一緒に置換される。
 */
export function applyInlinedImages(
  doc: Document,
  root: HTMLElement,
  images: Map<string, string>
): void {
  if (images.size === 0) return;

  const view = doc.defaultView ?? window;
  const base = document.baseURI;

  for (const node of elementsOf(root)) {
    if (node instanceof HTMLImageElement) {
      const src = node.currentSrc || node.src;
      const abs = src ? toAbsolute(src, base) : null;
      const dataUrl = abs ? images.get(abs) : undefined;
      if (dataUrl) {
        // srcset / <picture><source> は src より優先されるため取り除く
        node.removeAttribute('srcset');
        const picture = node.parentElement;
        if (picture?.tagName === 'PICTURE') {
          for (const source of Array.from(picture.querySelectorAll('source'))) source.remove();
        }
        node.src = dataUrl;
      }
    }

    const cs = view.getComputedStyle(node);
    for (const prop of IMAGE_PROPS) {
      const next = rewriteCssValue(cs[prop], base, images);
      if (next) node.style.setProperty(cssPropertyName(prop), next, 'important');
    }
  }
}

function cssPropertyName(prop: (typeof IMAGE_PROPS)[number]): string {
  switch (prop) {
    case 'backgroundImage':
      return 'background-image';
    case 'borderImageSource':
      return 'border-image-source';
    case 'listStyleImage':
      return 'list-style-image';
  }
}
