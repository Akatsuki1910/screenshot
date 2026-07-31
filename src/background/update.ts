/**
 * 更新チェック。配布ページの version.json を取りに行き、手元より新しければバッジで知らせる。
 *
 * GitHub Pages は Access-Control-Allow-Origin: * を返すので、
 * この取得のために host_permissions を追加する必要はない。
 */

import {
  CHECK_ALARM_NAME,
  CHECK_INTERVAL_MINUTES,
  CHECK_STALE_MS,
  EMPTY_UPDATE_STATE,
  UPDATE_MANIFEST_URL,
  UPDATE_STATE_KEY,
  hasUpdate,
  type RemoteVersion,
  type UpdateState
} from '../shared/update';

const FETCH_TIMEOUT_MS = 10_000;
// Chrome の manifest バージョンは各要素 0〜65535 の 1〜4 個
const VERSION_RE = /^\d{1,5}(\.\d{1,5}){0,3}$/;

export async function readUpdateState(): Promise<UpdateState> {
  try {
    const stored = await chrome.storage.local.get(UPDATE_STATE_KEY);
    return { ...EMPTY_UPDATE_STATE, ...(stored[UPDATE_STATE_KEY] as Partial<UpdateState>) };
  } catch {
    return { ...EMPTY_UPDATE_STATE };
  }
}

async function writeUpdateState(state: UpdateState): Promise<void> {
  try {
    await chrome.storage.local.set({ [UPDATE_STATE_KEY]: state });
  } catch {
    /* 保存できなくてもチェック自体は続行できる */
  }
}

/** 更新があればツールバーのアイコンにバッジを出す */
async function syncBadge(state: UpdateState): Promise<void> {
  const current = chrome.runtime.getManifest().version;
  const available = hasUpdate(current, state);
  try {
    await chrome.action.setBadgeText({ text: available ? 'NEW' : '' });
    if (available) {
      await chrome.action.setBadgeBackgroundColor({ color: '#1f883d' });
      await chrome.action.setTitle({
        title: `Element Screenshot — 新しいバージョン ${state.latest} があります`
      });
    } else {
      await chrome.action.setTitle({ title: 'Element Screenshot' });
    }
  } catch {
    /* アイコンが無い状況（起動直後など）は無視 */
  }
}

async function fetchRemoteVersion(): Promise<RemoteVersion> {
  const res = await fetch(UPDATE_MANIFEST_URL, {
    cache: 'no-store',
    credentials: 'omit',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as RemoteVersion;
  if (!data || typeof data.version !== 'string' || !VERSION_RE.test(data.version)) {
    throw new Error('version.json の内容が不正です');
  }
  return data;
}

/**
 * 更新をチェックして結果を保存する。
 * force が false の場合、前回から CHECK_STALE_MS 経っていなければ何もしない。
 */
export async function checkForUpdate(force = false): Promise<UpdateState> {
  const previous = await readUpdateState();

  if (!force && previous.checkedAt > 0 && Date.now() - previous.checkedAt < CHECK_STALE_MS) {
    // 取りに行かない場合でもバッジは保存済みの状態に合わせておく
    await syncBadge(previous);
    return previous;
  }

  let next: UpdateState;
  try {
    const remote = await fetchRemoteVersion();
    next = {
      checkedAt: Date.now(),
      latest: remote.version,
      latestCommit: remote.commit ?? null,
      latestBuiltAt: remote.builtAt ?? null,
      error: null
    };
  } catch (e) {
    next = {
      ...previous,
      checkedAt: Date.now(),
      error: (e as Error)?.message ?? String(e)
    };
  }

  await writeUpdateState(next);
  await syncBadge(next);
  return next;
}

/** 定期チェックのアラームを用意する（既にあれば作り直さない） */
export async function ensureUpdateAlarm(): Promise<void> {
  try {
    const existing = await chrome.alarms.get(CHECK_ALARM_NAME);
    if (existing) return;
    await chrome.alarms.create(CHECK_ALARM_NAME, {
      delayInMinutes: 1,
      periodInMinutes: CHECK_INTERVAL_MINUTES
    });
  } catch {
    /* alarms が使えなくても popup を開いたときのチェックは動く */
  }
}

/** service worker が起き直したときにバッジを復元する */
export async function restoreBadge(): Promise<void> {
  await syncBadge(await readUpdateState());
}
