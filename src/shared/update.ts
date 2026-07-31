/**
 * 更新チェックの共通定義。
 * 配布ページに置いてある version.json を見に行って、手元より新しければ知らせる。
 *
 * 配布元 URL はビルド時に package.json の homepage から注入される（vite.shared.ts）。
 */

/** 例: https://akatsuki1910.github.io/screenshot/ */
export const UPDATE_BASE_URL = __UPDATE_BASE_URL__;
export const UPDATE_MANIFEST_URL = `${UPDATE_BASE_URL}version.json`;

export const CHECK_ALARM_NAME = 'element-screenshot:check-update';
/** 自動チェックの間隔（分） */
export const CHECK_INTERVAL_MINUTES = 360;
/** popup を開いたときに再チェックするまでの最小間隔（ミリ秒） */
export const CHECK_STALE_MS = 60 * 60 * 1000;

export const UPDATE_STATE_KEY = 'updateState';

/** 配布ページが公開している version.json の中身 */
export interface RemoteVersion {
  version: string;
  commit?: string;
  builtAt?: string;
  zip?: string;
  page?: string;
}

/** chrome.storage.local に保存する最後のチェック結果 */
export interface UpdateState {
  /** 最後にチェックした時刻（epoch ms）。未チェックなら 0 */
  checkedAt: number;
  /** 取得できた最新バージョン。失敗時は null */
  latest: string | null;
  latestCommit: string | null;
  latestBuiltAt: string | null;
  /** 失敗した場合のメッセージ */
  error: string | null;
}

export const EMPTY_UPDATE_STATE: UpdateState = {
  checkedAt: 0,
  latest: null,
  latestCommit: null,
  latestBuiltAt: null,
  error: null
};

export interface CheckUpdateMessage {
  type: 'CHECK_UPDATE';
  /** 間隔を無視して必ず取りに行く */
  force?: boolean;
}

export interface CheckUpdateResponse {
  ok: boolean;
  state?: UpdateState;
  error?: string;
}

/**
 * 拡張機能のバージョン文字列を比較する。
 * manifest のバージョンは「1〜4 個のドット区切り整数」と決まっているので数値比較で厳密に判定できる。
 * a > b なら正、a < b なら負、同じなら 0。
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    String(v)
      .split('.')
      .map((part) => {
        const n = Number.parseInt(part, 10);
        return Number.isFinite(n) ? n : 0;
      });

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** 手元より新しいバージョンが公開されているか */
export function hasUpdate(current: string, state: UpdateState | undefined): boolean {
  if (!state?.latest) return false;
  return compareVersions(state.latest, current) > 0;
}
