// Offscreen document.
// MV3 の service worker では URL.createObjectURL が使えないため、
// ここで dataURL -> Blob -> blob: URL に変換する。

import type { OffscreenMessage, OffscreenResponse } from '../shared/types';

// service worker がダウンロード完了を通知できないまま終了した場合の保険。
// これを過ぎた blob URL は自動的に解放する。
const AUTO_REVOKE_MS = 5 * 60 * 1000;
const revokeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function revoke(url: string): void {
  const timer = revokeTimers.get(url);
  if (timer) {
    clearTimeout(timer);
    revokeTimers.delete(url);
  }
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* noop */
  }
}

chrome.runtime.onMessage.addListener(
  (msg: OffscreenMessage, _sender, sendResponse: (r: OffscreenResponse) => void) => {
    if (msg?.target !== 'offscreen') return false;

    if (msg.type === 'CREATE_BLOB_URL') {
      // fetch は data: URL をネイティブに解析でき、手動 atob より高速
      fetch(msg.dataUrl)
        .then((r) => r.blob())
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          revokeTimers.set(
            url,
            setTimeout(() => revoke(url), AUTO_REVOKE_MS)
          );
          sendResponse({ ok: true, url });
        })
        .catch((e: Error) => sendResponse({ ok: false, error: e.message }));
      return true; // 非同期レスポンス
    }

    if (msg.type === 'REVOKE_BLOB_URL') {
      revoke(msg.url);
      sendResponse({ ok: true });
      return false;
    }

    return false;
  }
);
