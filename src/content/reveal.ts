/**
 * 非表示要素を撮影するための仕組み。
 *
 * html2canvas は「clone した DOM」から描画範囲を算出する（onclone は範囲算出より前に走る）。
 * そのため onclone の中だけで表示状態に戻せば、実際のページには一切影響を与えずに
 * display:none / visibility:hidden / opacity:0 の要素を撮影できる。
 */

const defaultDisplayCache = new Map<string, string>();

/** そのタグ本来の display をブラウザに問い合わせる（display:none を何に戻すかの判断用） */
function defaultDisplayFor(tagName: string, doc: Document): string {
  const key = (tagName || 'div').toLowerCase();
  const cached = defaultDisplayCache.get(key);
  if (cached) return cached;

  let value = 'block';
  try {
    const view = doc.defaultView ?? window;
    const probe = doc.createElement(key);
    (doc.body ?? doc.documentElement).appendChild(probe);
    const display = view.getComputedStyle(probe).display;
    probe.remove();
    if (display && display !== 'none') value = display;
  } catch {
    /* 取得できなければ block を使う */
  }
  defaultDisplayCache.set(key, value);
  return value;
}

function forceVisible(node: HTMLElement, doc: Document): void {
  const view = doc.defaultView ?? window;
  const cs = view.getComputedStyle(node);

  if (node.hasAttribute('hidden')) node.removeAttribute('hidden');
  if (node instanceof HTMLDetailsElement) node.open = true;

  if (cs.display === 'none') {
    node.style.setProperty('display', defaultDisplayFor(node.tagName, doc), 'important');
  }
  if (cs.visibility === 'hidden' || cs.visibility === 'collapse') {
    node.style.setProperty('visibility', 'visible', 'important');
  }
  if (Number.parseFloat(cs.opacity) === 0) {
    node.style.setProperty('opacity', '1', 'important');
  }
  if (cs.contentVisibility === 'hidden') {
    node.style.setProperty('content-visibility', 'visible', 'important');
  }
}

/** clone 内で対象要素とその祖先すべてを表示状態にする */
export function revealInClone(doc: Document, clonedElement: HTMLElement): void {
  let node: HTMLElement | null = clonedElement;
  while (node) {
    forceVisible(node, doc);
    node = node.parentElement;
  }
}

/** 実際に画像として撮影できる状態か */
export function isRenderable(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const cs = getComputedStyle(el);
  if (cs.display === 'none') return false;
  if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
  if (Number.parseFloat(cs.opacity) === 0) return false;
  return true;
}
