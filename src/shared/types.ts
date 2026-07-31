/** 撮影進捗を popup に流すためのポート名 */
export const PROGRESS_PORT = 'capture-progress';

/** 外部画像を取り込むために必要な権限 */
export const ALL_URLS: chrome.permissions.Permissions = { origins: ['<all_urls>'] };

export type ImageFormat = 'png' | 'jpeg';

export interface CaptureOptions {
  /** 非表示の要素も撮影するか */
  includeHidden: boolean;
  /** 別ドメインの画像を拡張機能側で取得して埋め込むか（要権限） */
  inlineImages: boolean;
  /** ファイル名のプレフィックス */
  prefix: string;
  /** ダウンロードフォルダ内のサブフォルダ名（空なら直下） */
  folder: string;
  /** 0 以下なら devicePixelRatio を使う */
  scale: number;
  /** 背景を透過するか（true なら PNG、false なら JPEG で出力） */
  transparent: boolean;
  /** JPEG の品質 0-1 */
  quality: number;
  /** 撮影前に要素までスクロールするか */
  scrollIntoView: boolean;
}

export type CountResult =
  | { ok: true; total: number; visible: number }
  | { ok: false; error: string };

export type HighlightResult = { ok: true; count: number } | { ok: false; error: string };

export type CaptureResult =
  | { ok: true; saved: number; total: number; errors: string[] }
  | { ok: false; error: string };

export interface ProgressMessage {
  current: number;
  total: number;
}

export interface DownloadImageMessage {
  type: 'DOWNLOAD_IMAGE';
  dataUrl: string;
  filename: string;
}

export interface FetchImagesMessage {
  type: 'FETCH_IMAGES';
  urls: string[];
}

export type BackgroundMessage = DownloadImageMessage | FetchImagesMessage;

export interface DownloadImageResponse {
  ok: boolean;
  downloadId?: number;
  error?: string;
}

export interface FetchImagesResponse {
  ok: boolean;
  /** 取得できた URL のみ。値は data URL */
  images?: Record<string, string>;
  error?: string;
}

export type OffscreenMessage =
  | { target: 'offscreen'; type: 'CREATE_BLOB_URL'; dataUrl: string }
  | { target: 'offscreen'; type: 'REVOKE_BLOB_URL'; url: string };

export interface OffscreenResponse {
  ok: boolean;
  url?: string;
  error?: string;
}

/** content script がページの isolated world に生やす API */
export interface ElementScreenshotApi {
  version: string;
  count(selector: string): CountResult;
  highlight(selector: string, duration?: number): HighlightResult;
  capture(selector: string, options: CaptureOptions): Promise<CaptureResult>;
}

declare global {
  interface Window {
    __elementScreenshot__?: ElementScreenshotApi;
  }
}
