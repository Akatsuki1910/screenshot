import './popup.scss';
import {
  ALL_URLS,
  PROGRESS_PORT,
  type CaptureOptions,
  type CaptureResult,
  type CountResult,
  type ProgressMessage
} from '../shared/types';

// ---------- 設定 ----------

interface Settings {
  parentSelector: string;
  childSelector: string;
  directChild: boolean;
  includeHidden: boolean;
  inlineImages: boolean;
  prefix: string;
  folder: string;
  scale: string;
  quality: string;
  transparent: boolean;
  scrollIntoView: boolean;
}

const DEFAULTS: Settings = {
  parentSelector: '.preview-container',
  childSelector: '.message-preview-detail-container',
  directChild: true,
  includeHidden: true,
  inlineImages: false,
  prefix: 'element',
  folder: 'element-screenshot',
  scale: '0',
  quality: '0.92',
  transparent: false,
  scrollIntoView: true
};

const VERSION = chrome.runtime.getManifest().version;

// ---------- DOM ----------

function must<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`要素が見つかりません: #${id}`);
  return node as T;
}

const el = {
  parent: must<HTMLInputElement>('parentSelector'),
  child: must<HTMLInputElement>('childSelector'),
  direct: must<HTMLInputElement>('directChild'),
  includeHidden: must<HTMLInputElement>('includeHidden'),
  inlineImages: must<HTMLInputElement>('inlineImages'),
  resolved: must<HTMLElement>('resolvedSelector'),
  result: must<HTMLElement>('result'),
  prefix: must<HTMLInputElement>('prefix'),
  folder: must<HTMLInputElement>('folder'),
  scale: must<HTMLSelectElement>('scale'),
  quality: must<HTMLSelectElement>('quality'),
  transparent: must<HTMLInputElement>('transparent'),
  scrollIntoView: must<HTMLInputElement>('scrollIntoView'),
  recountBtn: must<HTMLButtonElement>('recountBtn'),
  highlightBtn: must<HTMLButtonElement>('highlightBtn'),
  saveBtn: must<HTMLButtonElement>('saveBtn'),
  progress: must<HTMLElement>('progress'),
  progressFill: must<HTMLElement>('progressFill'),
  progressText: must<HTMLElement>('progressText')
};

let currentCount = 0;
let busy = false;
let countToken = 0;

type ResultKind = 'idle' | 'ok' | 'zero' | 'error';

// ---------- ユーティリティ ----------

function buildSelector(): string {
  const parent = el.parent.value.trim();
  const child = el.child.value.trim();
  if (!parent && !child) return '';
  if (!parent) return child;
  if (!child) return parent;
  return `${parent} ${el.direct.checked ? '> ' : ''}${child}`;
}

function setResult(text: string, kind: ResultKind): void {
  el.result.textContent = text;
  el.result.className = `result result--${kind}`;
}

function syncButtons(): void {
  el.saveBtn.disabled = busy || currentCount < 1;
  el.highlightBtn.disabled = busy || currentCount < 1;
  el.recountBtn.disabled = busy;
}

function hideProgress(): void {
  el.progress.hidden = true;
  el.progressFill.style.width = '0%';
  el.progressText.textContent = '';
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const BLOCKED_HOSTS = /^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/;

type UrlCheck = { ok: true; isFile: boolean } | { ok: false; reason: string };

function checkUrl(url: string | undefined): UrlCheck {
  if (!url) return { ok: false, reason: 'このページでは実行できません' };
  if (BLOCKED_HOSTS.test(url)) {
    return { ok: false, reason: 'Chrome ウェブストア上では実行できません' };
  }
  if (!/^(https?|file):/.test(url)) {
    return {
      ok: false,
      reason: 'このページでは実行できません（http / https / file のページを開いてください）'
    };
  }
  return { ok: true, isFile: url.startsWith('file:') };
}

function accessErrorMessage(e: Error, isFile: boolean): string {
  if (isFile) {
    return 'ローカルファイルにアクセスできません。chrome://extensions で本拡張の「ファイルの URL へのアクセスを許可する」をオンにしてください';
  }
  return `ページにアクセスできません: ${e.message}`;
}

/**
 * content script を注入する。既に同じバージョンが入っていれば何もしない。
 * html2canvas ごとバンドルされているので、毎回注入するとコストが高いため必ず probe する。
 */
async function ensureInjected(tabId: number): Promise<void> {
  const [probe] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__elementScreenshot__?.version ?? null
  });
  if (probe?.result === VERSION) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

// ---------- 設定の保存／復元 ----------

async function loadSettings(): Promise<void> {
  let saved: Settings = DEFAULTS;
  try {
    saved = (await chrome.storage.local.get(DEFAULTS)) as Settings;
  } catch {
    /* 読めなければデフォルトで続行 */
  }
  el.parent.value = saved.parentSelector;
  el.child.value = saved.childSelector;
  el.direct.checked = saved.directChild;
  el.includeHidden.checked = saved.includeHidden;
  el.prefix.value = saved.prefix;
  el.folder.value = saved.folder;
  el.scale.value = saved.scale;
  el.quality.value = saved.quality;
  el.transparent.checked = saved.transparent;
  el.scrollIntoView.checked = saved.scrollIntoView;

  // 権限が取り消されている場合があるので実際の状態に合わせる
  const granted = await chrome.permissions.contains(ALL_URLS).catch(() => false);
  el.inlineImages.checked = saved.inlineImages && granted;
}

function saveSettings(): void {
  const settings: Settings = {
    parentSelector: el.parent.value,
    childSelector: el.child.value,
    directChild: el.direct.checked,
    includeHidden: el.includeHidden.checked,
    inlineImages: el.inlineImages.checked,
    prefix: el.prefix.value,
    folder: el.folder.value,
    scale: el.scale.value,
    quality: el.quality.value,
    transparent: el.transparent.checked,
    scrollIntoView: el.scrollIntoView.checked
  };
  chrome.storage.local.set(settings).catch(() => {});
}

// ---------- カウント ----------

async function count(): Promise<void> {
  const token = ++countToken;
  const selector = buildSelector();
  el.resolved.textContent = selector || '-';

  const finish = (text: string, kind: ResultKind, n: number): void => {
    if (token !== countToken) return; // 新しいカウントが走っていれば破棄
    currentCount = n;
    setResult(text, kind);
    syncButtons();
  };

  if (!selector) return finish('セレクタを入力してください', 'idle', 0);

  let isFile = false;
  try {
    const tab = await getActiveTab();
    const urlCheck = checkUrl(tab?.url);
    if (!tab?.id || !urlCheck.ok) {
      return finish(urlCheck.ok ? 'このページでは実行できません' : urlCheck.reason, 'error', 0);
    }
    isFile = urlCheck.isFile;

    await ensureInjected(tab.id);
    const [first] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (sel: string) => window.__elementScreenshot__!.count(sel),
      args: [selector]
    });
    const result = first?.result as CountResult | undefined;

    if (!result?.ok) {
      return finish(`セレクタが不正です: ${result?.error ?? 'unknown error'}`, 'error', 0);
    }
    if (result.total === 0) {
      return finish('0 件 — 該当する要素が見つかりません', 'zero', 0);
    }

    const hidden = result.total - result.visible;

    if (el.includeHidden.checked) {
      const note = hidden > 0 ? `（非表示 ${hidden} 件を含む）` : '';
      return finish(`${result.total} 件 — 保存できます ${note}`, 'ok', result.total);
    }
    if (result.visible === 0) {
      return finish(
        `${result.total} 件ヒットしましたが全て非表示です（「非表示の要素も撮影する」をオンにしてください）`,
        'zero',
        0
      );
    }
    const note = hidden > 0 ? `（非表示 ${hidden} 件を除く）` : '';
    return finish(`${result.visible} 件 — 保存できます ${note}`, 'ok', result.visible);
  } catch (e) {
    return finish(accessErrorMessage(e as Error, isFile), 'error', 0);
  }
}

// ---------- ハイライト ----------

async function highlight(): Promise<void> {
  const selector = buildSelector();
  if (!selector) return;

  try {
    const tab = await getActiveTab();
    if (!tab?.id || !checkUrl(tab.url).ok) return;

    await ensureInjected(tab.id);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (sel: string) => window.__elementScreenshot__!.highlight(sel, 2500),
      args: [selector]
    });
  } catch (e) {
    setResult(`ハイライトに失敗しました: ${(e as Error).message}`, 'error');
  }
}

// ---------- 保存 ----------

async function save(): Promise<void> {
  const selector = buildSelector();
  if (!selector || currentCount < 1 || busy) return;

  let tab: chrome.tabs.Tab | undefined;
  try {
    tab = await getActiveTab();
  } catch (e) {
    setResult(`タブを取得できません: ${(e as Error).message}`, 'error');
    return;
  }

  const urlCheck = checkUrl(tab?.url);
  if (!tab?.id || !urlCheck.ok) {
    setResult(urlCheck.ok ? 'このページでは実行できません' : urlCheck.reason, 'error');
    return;
  }
  const tabId = tab.id;

  busy = true;
  syncButtons();
  el.progress.hidden = false;
  el.progressFill.style.width = '0%';
  el.progressText.textContent = '準備中...';

  const options: CaptureOptions = {
    includeHidden: el.includeHidden.checked,
    inlineImages: el.inlineImages.checked,
    prefix: el.prefix.value.trim() || DEFAULTS.prefix,
    folder: el.folder.value.trim(),
    scale: Number(el.scale.value),
    quality: Number(el.quality.value),
    transparent: el.transparent.checked,
    scrollIntoView: el.scrollIntoView.checked
  };

  try {
    await ensureInjected(tabId);
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel: string, opts: CaptureOptions) => window.__elementScreenshot__!.capture(sel, opts),
      args: [selector, options]
    });
    const result = first?.result as CaptureResult | undefined;

    if (!result?.ok) {
      setResult(`保存に失敗しました: ${result?.error ?? 'unknown error'}`, 'error');
      el.progressText.textContent = '';
    } else if (result.errors.length > 0) {
      setResult(
        `${result.saved} / ${result.total} 件を保存（${result.errors.length} 件失敗）`,
        'zero'
      );
      el.progressText.textContent = result.errors.slice(0, 2).join(' / ');
    } else {
      setResult(`${result.saved} 件を保存しました`, 'ok');
      el.progressFill.style.width = '100%';
      el.progressText.textContent = options.folder
        ? `ダウンロード/${options.folder}/ に保存しました`
        : 'ダウンロードフォルダに保存しました';
    }
  } catch (e) {
    setResult(`保存に失敗しました: ${(e as Error).message}`, 'error');
    el.progressText.textContent = '';
  } finally {
    busy = false;
    syncButtons();
  }
}

// ---------- 進捗受信（ポート経由：画像データは popup に流れない） ----------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PROGRESS_PORT) return;
  port.onMessage.addListener((msg: ProgressMessage) => {
    if (!msg?.total) return;
    el.progress.hidden = false;
    el.progressFill.style.width = `${Math.round((msg.current / msg.total) * 100)}%`;
    el.progressText.textContent = `撮影中 ${msg.current} / ${msg.total}`;
  });
});

// ---------- イベント ----------

let debounceId: ReturnType<typeof setTimeout> | undefined;

function onSelectorChanged(): void {
  el.resolved.textContent = buildSelector() || '-';
  hideProgress();
  saveSettings();
  clearTimeout(debounceId);
  debounceId = setTimeout(() => void count(), 300);
}

for (const input of [el.parent, el.child]) {
  input.addEventListener('input', onSelectorChanged);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !el.saveBtn.disabled) void save();
  });
}

el.direct.addEventListener('change', onSelectorChanged);
el.includeHidden.addEventListener('change', onSelectorChanged);

for (const input of [
  el.prefix,
  el.folder,
  el.scale,
  el.quality,
  el.transparent,
  el.scrollIntoView
]) {
  input.addEventListener('change', saveSettings);
}

// 別ドメインの画像取り込みは追加の権限が要る。
// change イベントはユーザー操作なので、そのまま permissions.request を呼べる。
el.inlineImages.addEventListener('change', () => {
  // 権限ダイアログが開くと popup は閉じられ then が走らないことがあるので、先に保存しておく。
  // 拒否された場合は次回起動時の permissions.contains チェックで OFF に戻る。
  saveSettings();
  if (!el.inlineImages.checked) return;

  chrome.permissions
    .request(ALL_URLS)
    .then((granted) => {
      el.inlineImages.checked = granted;
      if (!granted) {
        setResult('権限が許可されなかったため、別ドメインの画像は取り込みません', 'zero');
      }
      saveSettings();
    })
    .catch((e: Error) => {
      el.inlineImages.checked = false;
      setResult(`権限を要求できません: ${e.message}`, 'error');
      saveSettings();
    });
});

el.recountBtn.addEventListener('click', () => {
  hideProgress();
  void count();
});
el.highlightBtn.addEventListener('click', () => void highlight());
el.saveBtn.addEventListener('click', () => void save());

// ---------- 初期化 ----------

void (async () => {
  try {
    await loadSettings();
    await count();
  } catch (e) {
    setResult(`初期化に失敗しました: ${(e as Error).message}`, 'error');
  }
})();
