// Service worker: content script から受け取った画像を実ファイルとして保存する。
//
// MV3 の service worker では URL.createObjectURL が使えず、
// また chrome.downloads は URL 長 約2MB の制限があるため data: URL を直接渡すと
// 大きな画像で失敗する。そこで offscreen document で blob: URL に変換してから渡す。

import { sanitizeFilename } from '../shared/filename';
import type {
  BackgroundMessage,
  DownloadImageResponse,
  FetchImagesResponse,
  ImageFormat,
  OffscreenMessage,
  OffscreenResponse
} from '../shared/types';

const OFFSCREEN_URL = 'offscreen.html';
const DATA_URL_SAFE_LIMIT = 1_500_000; // これ以下なら data: URL 直渡しでも安全
const ALLOWED_PREFIXES = ['data:image/png;base64,', 'data:image/jpeg;base64,'];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const FETCH_CONCURRENCY = 6;

let offscreenPromise: Promise<void> | null = null;
const blobUrlsByDownloadId = new Map<number, string>();

// ---------- offscreen document ----------

async function hasOffscreenDocument(): Promise<boolean> {
  // getContexts が正式な API（Chrome 116+）。無い場合のみ hasDocument にフォールバック。
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
    });
    return contexts.length > 0;
  }
  if (chrome.offscreen.hasDocument) return chrome.offscreen.hasDocument();
  return false;
}

async function ensureOffscreen(): Promise<boolean> {
  if (!chrome.offscreen) return false;
  try {
    if (await hasOffscreenDocument()) return true;
    offscreenPromise ??= chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: '大きなスクリーンショットを保存するために blob URL を生成します'
      })
      .finally(() => {
        offscreenPromise = null;
      });
    await offscreenPromise;
    return true;
  } catch (e) {
    // 同時生成のレースで既に存在している場合は成功扱い
    if (String((e as Error)?.message).includes('Only a single offscreen')) return true;
    console.warn('[Element Screenshot] offscreen document を作成できません:', e);
    return false;
  }
}

async function toDownloadableUrl(dataUrl: string): Promise<{ url: string; isBlob: boolean }> {
  if (dataUrl.length <= DATA_URL_SAFE_LIMIT) return { url: dataUrl, isBlob: false };

  if (await ensureOffscreen()) {
    const message: OffscreenMessage = { target: 'offscreen', type: 'CREATE_BLOB_URL', dataUrl };
    const res: OffscreenResponse | undefined = await chrome.runtime.sendMessage(message);
    if (res?.ok && res.url) return { url: res.url, isBlob: true };
  }
  throw new Error('画像が大きすぎます（解像度を下げてお試しください）');
}

function revokeBlobUrl(url: string): void {
  const message: OffscreenMessage = { target: 'offscreen', type: 'REVOKE_BLOB_URL', url };
  chrome.runtime.sendMessage(message).catch(() => {});
}

// ---------- 保存 ----------

async function saveImage(dataUrl: unknown, filename: unknown): Promise<number> {
  const valid =
    typeof dataUrl === 'string' &&
    dataUrl.length >= 64 &&
    ALLOWED_PREFIXES.some((p) => dataUrl.startsWith(p));
  if (!valid) throw new Error('画像の生成に失敗しました');

  // 拡張子は content script の申告ではなく実データから決める
  const format: ImageFormat = dataUrl.startsWith('data:image/png') ? 'png' : 'jpeg';

  const { url, isBlob } = await toDownloadableUrl(dataUrl);
  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: sanitizeFilename(typeof filename === 'string' ? filename : undefined, format),
      saveAs: false,
      conflictAction: 'uniquify'
    });
    if (isBlob) blobUrlsByDownloadId.set(downloadId, url);
    return downloadId;
  } catch (e) {
    if (isBlob) revokeBlobUrl(url);
    throw e;
  }
}

chrome.downloads.onChanged.addListener(async (delta) => {
  const state = delta.state?.current;
  if (state !== 'complete' && state !== 'interrupted') return;

  // 再開できる中断はまだ URL が必要なので revoke しない
  if (state === 'interrupted') {
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (item?.canResume) return;
  }

  const url = blobUrlsByDownloadId.get(delta.id);
  if (url) {
    blobUrlsByDownloadId.delete(delta.id);
    revokeBlobUrl(url);
  }
});

// ---------- 画像の取得（CORS 回避） ----------
//
// content script からの fetch はページのオリジン扱いになるため、別ドメインの画像は
// CORS でブロックされる。service worker なら optional_host_permissions で許可された
// オリジンに対して制限なく取得できるので、ここで data URL 化して返す。

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
    if (!res.ok) return null;

    const blob = await res.blob();
    if (!blob.type.startsWith('image/') || blob.size === 0 || blob.size > MAX_IMAGE_BYTES) {
      return null;
    }
    return `data:${blob.type};base64,${toBase64(await blob.arrayBuffer())}`;
  } catch {
    return null;
  }
}

async function fetchImages(urls: unknown): Promise<Record<string, string>> {
  if (!Array.isArray(urls)) return {};

  const targets = urls.filter((u): u is string => typeof u === 'string').slice(0, 200);
  const images: Record<string, string> = {};
  let cursor = 0;

  const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, targets.length) }, async () => {
    while (cursor < targets.length) {
      const url = targets[cursor++]!;
      const dataUrl = await fetchAsDataUrl(url);
      if (dataUrl) images[url] = dataUrl;
    }
  });

  await Promise.all(workers);
  return images;
}

// ---------- メッセージ ----------

chrome.runtime.onMessage.addListener(
  (
    msg: BackgroundMessage,
    _sender,
    sendResponse: (r: DownloadImageResponse | FetchImagesResponse) => void
  ) => {
    if (msg?.type === 'DOWNLOAD_IMAGE') {
      saveImage(msg.dataUrl, msg.filename)
        .then((downloadId) => sendResponse({ ok: true, downloadId }))
        .catch((e: Error) => sendResponse({ ok: false, error: e?.message ?? String(e) }));
      return true; // 非同期レスポンス
    }

    if (msg?.type === 'FETCH_IMAGES') {
      fetchImages(msg.urls)
        .then((images) => sendResponse({ ok: true, images }))
        .catch((e: Error) => sendResponse({ ok: false, error: e?.message ?? String(e) }));
      return true;
    }

    return false;
  }
);
