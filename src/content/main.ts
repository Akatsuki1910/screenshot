// popup から chrome.scripting.executeScript で注入される（ページの isolated world で実行）。
// html2canvas はこのファイルにバンドルされている。
// 多重注入されても安全なように、拡張バージョンでガードする。

import html2canvas from 'html2canvas';
import { isRenderable, revealInClone } from './reveal';
import { applyInlinedImages, collectExternalImageUrls, resolveImages } from './inline-images';
import { extensionFor, mimeFor, pad, sanitizePart } from '../shared/filename';
import {
  PROGRESS_PORT,
  type CaptureOptions,
  type CaptureResult,
  type CountResult,
  type DownloadImageMessage,
  type DownloadImageResponse,
  type ElementScreenshotApi,
  type HighlightResult,
  type ImageFormat,
  type ProgressMessage
} from '../shared/types';

const VERSION = chrome.runtime.getManifest().version;

if (window.__elementScreenshot__?.version !== VERSION) {
  const HIGHLIGHT_STYLE_ID = '__element-screenshot-highlight-style__';
  const HIGHLIGHT_CLASS = '__element-screenshot-highlight__';

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const queryAll = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector));

  let highlightTimer: ReturnType<typeof setTimeout> | undefined;

  async function waitForImages(el: HTMLElement, timeout = 5000): Promise<void> {
    const imgs = Array.from(el.querySelectorAll('img'));
    if (el instanceof HTMLImageElement) imgs.unshift(el); // 対象自身が <img> のケース

    const pending = imgs
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          })
      );
    if (pending.length === 0) return;
    await Promise.race([Promise.all(pending).then(() => undefined), sleep(timeout)]);
  }

  interface ScrollSnapshot {
    window: { x: number; y: number };
    nodes: { el: HTMLElement; top: number; left: number }[];
  }

  /** 対象要素の祖先すべてのスクロール位置を記録して、あとで復元できるようにする */
  function snapshotScroll(targets: HTMLElement[]): ScrollSnapshot {
    const nodes = new Set<HTMLElement>();
    for (const target of targets) {
      let node = target.parentElement;
      while (node) {
        nodes.add(node);
        node = node.parentElement;
      }
    }
    return {
      window: { x: window.scrollX, y: window.scrollY },
      nodes: [...nodes].map((el) => ({ el, top: el.scrollTop, left: el.scrollLeft }))
    };
  }

  function restoreScroll(snapshot: ScrollSnapshot): void {
    for (const { el, top, left } of snapshot.nodes) {
      el.scrollTop = top;
      el.scrollLeft = left;
    }
    window.scrollTo({ left: snapshot.window.x, top: snapshot.window.y, behavior: 'instant' });
  }

  function clearHighlight(): void {
    for (const el of queryAll('.' + HIGHLIGHT_CLASS)) el.classList.remove(HIGHLIGHT_CLASS);
  }

  const api: ElementScreenshotApi = {
    version: VERSION,

    // ---- 件数カウント ----
    count(selector: string): CountResult {
      try {
        const all = queryAll(selector);
        return { ok: true, total: all.length, visible: all.filter(isRenderable).length };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    // ---- ハイライト ----
    highlight(selector: string, duration = 2500): HighlightResult {
      try {
        let style = document.getElementById(HIGHLIGHT_STYLE_ID);
        if (!style) {
          style = document.createElement('style');
          style.id = HIGHLIGHT_STYLE_ID;
          style.setAttribute('data-html2canvas-ignore', 'true');
          style.textContent =
            `.${HIGHLIGHT_CLASS}{outline:3px solid #ff5c00 !important;` +
            'outline-offset:2px !important;background-color:rgba(255,92,0,.08) !important}';
          document.documentElement.appendChild(style);
        }
        const els = queryAll(selector);
        for (const el of els) el.classList.add(HIGHLIGHT_CLASS);
        els[0]?.scrollIntoView({ block: 'center', behavior: 'instant' });

        clearTimeout(highlightTimer);
        highlightTimer = setTimeout(clearHighlight, duration);
        return { ok: true, count: els.length };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    // ---- 撮影＆保存 ----
    async capture(selector: string, options: CaptureOptions): Promise<CaptureResult> {
      const includeHidden = options.includeHidden !== false;

      let targets: HTMLElement[];
      let hiddenSet: Set<HTMLElement>;
      try {
        const all = queryAll(selector);
        hiddenSet = new Set(all.filter((n) => !isRenderable(n)));
        targets = includeHidden ? all : all.filter((n) => !hiddenSet.has(n));
      } catch (e) {
        return { ok: false, error: `セレクタが不正です: ${(e as Error).message}` };
      }
      if (targets.length === 0) return { ok: false, error: '撮影できる要素がありません' };

      const prefix = sanitizePart(options.prefix, 'element');
      const folder = options.folder ? sanitizePart(options.folder, '') : '';
      const scale = options.scale > 0 ? options.scale : window.devicePixelRatio || 1;
      const digits = String(targets.length).length;

      // 透過が必要なら PNG、そうでなければファイルサイズの小さい JPEG
      const format: ImageFormat = options.transparent ? 'png' : 'jpeg';
      const mime = mimeFor(format);
      const ext = extensionFor(format);
      const quality = options.quality > 0 && options.quality <= 1 ? options.quality : 0.92;

      clearTimeout(highlightTimer);
      clearHighlight(); // 撮影対象に写り込まないように
      const snapshot = snapshotScroll(targets);

      // popup が閉じていると受信側が無く非同期に disconnect される。
      // lastError を読まないとホストページのコンソールに警告が出るので必ず参照する。
      let port: chrome.runtime.Port | null = null;
      try {
        port = chrome.runtime.connect({ name: PROGRESS_PORT });
        port.onDisconnect.addListener(() => {
          void chrome.runtime.lastError;
          port = null;
        });
      } catch {
        port = null;
      }

      const errors: string[] = [];
      let saved = 0;

      for (let i = 0; i < targets.length; i++) {
        const el = targets[i]!;
        const label = `#${i + 1}`;
        const isHidden = hiddenSet.has(el);

        try {
          const progress: ProgressMessage = { current: i + 1, total: targets.length };
          try {
            port?.postMessage(progress);
          } catch {
            port = null;
          }

          if (options.scrollIntoView !== false && !isHidden) {
            el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
            await sleep(120);
          }
          await waitForImages(el);

          // 別ドメインの画像は CORS で描画されないため、先に data URL 化しておく
          const images = options.inlineImages
            ? await resolveImages(collectExternalImageUrls(el))
            : new Map<string, string>();

          const needsClonePatch = isHidden || images.size > 0;

          const canvas = await html2canvas(el, {
            backgroundColor: options.transparent ? null : '#ffffff',
            scale,
            useCORS: true,
            allowTaint: false,
            logging: false,
            removeContainer: true,
            imageTimeout: 15000,
            // clone の中だけを書き換える。実ページには影響しない
            ...(needsClonePatch
              ? {
                  onclone: (doc: Document, cloned: HTMLElement) => {
                    if (isHidden) revealInClone(doc, cloned);
                    if (images.size > 0) applyInlinedImages(doc, cloned, images);
                  }
                }
              : {})
          });

          const dataUrl = canvas.toDataURL(mime, quality);
          // サイズ 0 や巨大すぎる canvas では toDataURL が "data:," を返す
          if (!dataUrl.startsWith(`data:${mime}`) || canvas.width === 0 || canvas.height === 0) {
            throw new Error(
              isHidden
                ? '非表示要素を表示状態に戻せませんでした（サイズ 0）'
                : '画像化に失敗しました（要素が大きすぎる可能性があります）'
            );
          }

          const name = `${prefix}-${pad(i + 1, digits)}.${ext}`;
          const message: DownloadImageMessage = {
            type: 'DOWNLOAD_IMAGE',
            dataUrl,
            filename: folder ? `${folder}/${name}` : name
          };
          const res: DownloadImageResponse | undefined = await chrome.runtime.sendMessage(message);

          if (res?.ok) saved++;
          else errors.push(`${label}: ${res?.error ?? '保存に失敗しました'}`);
        } catch (e) {
          errors.push(`${label}: ${(e as Error)?.message ?? String(e)}`);
        }
      }

      try {
        port?.disconnect();
      } catch {
        /* noop */
      }
      restoreScroll(snapshot);

      return { ok: true, saved, total: targets.length, errors };
    }
  };

  window.__elementScreenshot__ = api;
}
