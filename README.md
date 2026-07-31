# Element Screenshot

[![CI](https://github.com/Akatsuki1910/screenshot/actions/workflows/ci.yml/badge.svg)](https://github.com/Akatsuki1910/screenshot/actions/workflows/ci.yml)
[![Deploy](https://github.com/Akatsuki1910/screenshot/actions/workflows/deploy.yml/badge.svg)](https://github.com/Akatsuki1910/screenshot/actions/workflows/deploy.yml)
[![Download](https://img.shields.io/badge/download-latest%20build-1f883d)](https://akatsuki1910.github.io/screenshot/)
[![Chrome](https://img.shields.io/badge/Chrome-109%2B-4285F4?logo=googlechrome&logoColor=white)](https://www.google.com/chrome/)

指定した CSS セレクタに一致する **全ての要素** のスクリーンショットを撮影し、連番の画像として保存する Chrome 拡張機能です。

デフォルトは `.preview-container > .message-preview-detail-container` ですが、セレクタは自由に変更できます。

## ダウンロード

ビルド済みの zip を配布ページから取得できます。main へマージするたびに自動更新されます。

**→ [https://akatsuki1910.github.io/screenshot/](https://akatsuki1910.github.io/screenshot/)**

1. zip をダウンロードして展開する
2. Chrome で `chrome://extensions` を開き、**デベロッパーモード** をオンにする
3. **パッケージ化されていない拡張機能を読み込む** から展開したフォルダを選択

自分でビルドする場合は下記へ。

## セットアップ

```bash
npm install
npm run build
```

`dist/` が出力されます。

1. Chrome で `chrome://extensions` を開く
2. 右上の **デベロッパーモード** をオンにする
3. **パッケージ化されていない拡張機能を読み込む** をクリック
4. **`dist/` フォルダ** を選択（リポジトリのルートではありません）

開発中はソースの変更を監視して自動ビルドできます。

```bash
npm run watch      # 3 つの vite build --watch を並列起動
npm run typecheck  # tsc --noEmit
npm run verify     # dist/ の健全性チェック（CI と同じもの）
npm run build:site # 配布ページ + zip を _site/ に生成
```

`dist/` を更新したら、`chrome://extensions` で拡張機能の再読み込みボタンを押してください。

## 更新のお知らせ

新しいバージョンが公開されると、拡張機能側が気づいて知らせます。

- ツールバーのアイコンに **NEW** バッジが付く
- ポップアップの上部に「新しいバージョン x.y.z があります」と表示され、配布ページへのリンクが出る
- ポップアップ下部の **更新を確認** で手動チェックもできる

配布ページに一緒に置いてある [`version.json`](https://akatsuki1910.github.io/screenshot/version.json) を、6 時間ごと（`chrome.alarms`）とポップアップを開いたとき（前回から 1 時間以上経っていれば）に見に行きます。GitHub Pages は `Access-Control-Allow-Origin: *` を返すため、このチェックのために追加のホスト権限は要りません（`alarms` 権限のみ追加）。

Chrome ウェブストア外の拡張機能は自動更新されないので、更新は zip を落として入れ直す形になります。

## 使い方

1. 撮影したいページを開く
2. ツールバーの拡張機能アイコンをクリック
3. **親セレクタ** と **子セレクタ** を入力（デフォルト値が入っています）
4. 入力すると自動で件数が表示される
   - `0 件` → 保存ボタンは押せません
   - `1 件以上` → 保存ボタンが有効になります
5. **保存** を押すと、ダウンロードフォルダに連番の画像が保存されます

```
ダウンロード/element-screenshot/element-1.jpg
ダウンロード/element-screenshot/element-2.jpg
...
```

`ハイライト` ボタンを押すと、ページ上でヒットした要素がオレンジ色の枠で表示されます（撮影前の確認用）。

### セレクタの組み立て

| 入力 | 結果 |
| --- | --- |
| 親 `.preview-container` / 子 `.message-preview-detail-container` / 直下ON | `.preview-container > .message-preview-detail-container` |
| 同上 / 直下OFF | `.preview-container .message-preview-detail-container` |
| 親のみ | `.preview-container` |
| 子のみ | `.message-preview-detail-container` |

任意の CSS セレクタが使えます（`#id`、`[data-foo]`、`:nth-child()` など）。

### オプション

| 項目 | デフォルト | 説明 |
| --- | --- | --- |
| 直下の子要素のみ（`>`） | ON | 親の直下だけに絞る |
| 非表示の要素も撮影する | **ON** | `display:none` / `visibility:hidden` / `opacity:0` の要素も撮影する |
| ファイル名 | `element` | 連番の前につくプレフィックス |
| 保存先 | `element-screenshot` | ダウンロードフォルダ内のサブフォルダ名。空にすると直下に保存 |
| 解像度 | 自動 | 自動は画面の devicePixelRatio。2x / 3x で高解像度化 |
| JPEG品質 | 92% | JPEG 保存時のみ有効 |
| 背景を透過する | OFF | **OFF なら JPEG、ON なら PNG** で保存 |
| 別ドメインの画像も取り込む | OFF | 下記「background-image が撮れない場合」を参照 |
| 撮影前に要素までスクロール | ON | 遅延読み込み（lazy load）画像がある場合に有効 |

入力内容は自動保存され、次回ポップアップを開いたときに復元されます。

## 仕組みと制限

### 非表示の要素

html2canvas はページを clone してから描画するため、**clone の中だけを表示状態に戻して撮影**しています。実際のページの表示は一切変わりません。祖先が `display:none` の場合は祖先ごと戻します。

`display:none` を解除するときの `display` 値は、そのタグ本来の値（ブラウザに問い合わせた UA デフォルト）を使います。元が `flex` だった要素などはレイアウトが崩れる場合があります。

### background-image が撮れない場合

別ドメインの画像は CORS ヘッダが無いと html2canvas が描画しません（canvas が汚染され保存できなくなるため）。これが背景画像や `<img>` が空白になる主な原因です。

**別ドメインの画像も取り込む** をオンにすると、service worker 側で画像を取得して data URL として clone に埋め込むため、CORS に関係なく撮影できます。オンにした時点で Chrome の権限ダイアログが表示されます（許可しなければ従来どおりの動作）。

`<img>` / `background-image` / `border-image` / `list-style-image` と、`::before` `::after` の背景画像に対応しています。同一ドメインの画像は権限なしでそのまま撮影できます。

### その他

- 画面外の要素も撮影されます。
- `iframe` の中身、`canvas` の内容、動画のフレーム、一部の CSS フィルタや `backdrop-filter` は再現されません（html2canvas の制限）。
- `chrome://` や Chrome ウェブストアのページでは動作しません。
- `file://` のページで使うには `chrome://extensions` で **ファイルの URL へのアクセスを許可する** をオンにしてください。
- Chrome 109 以上が必要です。

## 動作確認

`test/sample.html` をブラウザで開いて試せます。デフォルトのセレクタで、直下ON なら 8 件（うち非表示 2 件）、OFF なら 10 件（うち非表示 3 件）がヒットします。グラデーション背景・`background-image`・疑似要素の背景画像のサンプルも含まれています。

## リリース手順

1. `package.json` の `version` を上げる（**ここだけでOK**。`public/manifest.json` はビルド時に自動同期されます）
2. main にマージする

Actions がビルドして Pages を更新し、既存ユーザーの拡張機能が次のチェックで気づきます。

## CI / デプロイ

| ワークフロー | 実行タイミング | 内容 |
| --- | --- | --- |
| `ci.yml` | 全ブランチへの push・PR | typecheck → build → dist 検証 → 成果物を artifact にアップロード |
| `deploy.yml` | main への push・手動実行 | typecheck → build → dist 検証 → zip 化 → GitHub Pages にデプロイ |

依存関係は Dependabot が更新します（`.github/dependabot.yml`）。npm は毎日・production / development でグループ化、GitHub Actions は毎週まとめて 1 PR。PR には `ci.yml` が走るので、ビルドが通るかは自動で確認されます。

`scripts/verify-dist.mjs` が、manifest の参照切れ・content script への ESM 混入・html2canvas の同梱漏れ・絶対パス参照・バージョン不一致・更新チェック URL の埋め込み漏れを検査します。壊れたビルドは公開されません。

> **初回のみ必要な設定**
> リポジトリの Settings → Pages → **Build and deployment → Source** を **GitHub Actions** に変更してください。これをしないと `deploy.yml` が失敗します。

## 構成

```
.github/workflows/            CI とデプロイ
site/index.html               配布ページのテンプレート
popup.html / offscreen.html   拡張機能ページのエントリ
public/
  manifest.json               MV3 マニフェスト（version は自動同期）
  icons/
src/
  popup/main.ts               UI・件数カウント・保存の起点
  popup/popup.scss            スタイル
  content/main.ts             ページに注入。カウント / ハイライト / 撮影
  content/reveal.ts           非表示要素を clone 内で復帰させる
  content/inline-images.ts    別ドメイン画像の data URL 化
  background/main.ts          service worker。保存・画像取得・更新チェックの起点
  background/update.ts        version.json の取得とバッジ表示
  offscreen/main.ts           大きな画像用の blob URL 生成
  shared/                     型・ファイル名サニタイズ・バージョン比較
scripts/
  clean.mjs                   dist/ の削除
  sync-version.mjs            package.json → manifest.json のバージョン同期
  watch.mjs                   3 つの vite watch を並列起動
  verify-dist.mjs             ビルド成果物の検証
  build-site.mjs              zip + version.json + 配布ページを _site/ に生成
vite.config.ts                popup / offscreen（ESM）
vite.config.content.ts        content script（IIFE 単一ファイル）
vite.config.background.ts     service worker（IIFE 単一ファイル）
vite.shared.ts                配布元 URL の注入など共通設定
test/sample.html              動作確認用ページ
```

### 実装メモ

- content script は `chrome.scripting.executeScript({ files })` で注入するため ESM が使えず、html2canvas ごと 1 ファイルの IIFE にバンドルしています。注入前に必ずバージョンを probe して、二重注入とコストを避けています。
- 常時アクセス権（`host_permissions`）は要求しません。通常は `activeTab` のみ、外部画像の取り込みだけ `optional_host_permissions` で必要時にリクエストします。
- 更新チェックの配布元 URL は `package.json` の `homepage` からビルド時に注入されます（`vite.shared.ts` の `define`）。ソースにハードコードされた URL はありません。
- `chrome.downloads` には URL 長 約 2MB の制限があるため、大きな画像は offscreen document で `blob:` URL に変換してから渡します。
- ファイル名は content script 側と service worker 側の両方でサニタイズし、ダウンロードフォルダ外への書き込みを防いでいます。

## ライセンス

依存している html2canvas は MIT License (© Niklas von Hertzen) です。
