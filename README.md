# Element Screenshot

指定した CSS セレクタに一致する **全ての要素** のスクリーンショットを撮影し、連番の画像として保存する Chrome 拡張機能です。

デフォルトは `.preview-container > .message-preview-detail-container` ですが、セレクタは自由に変更できます。

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
```

`dist/` を更新したら、`chrome://extensions` で拡張機能の再読み込みボタンを押してください。

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

## 構成

```
popup.html / offscreen.html   拡張機能ページのエントリ
public/
  manifest.json               MV3 マニフェスト
  icons/
src/
  popup/main.ts               UI・件数カウント・保存の起点
  popup/popup.scss            スタイル
  content/main.ts             ページに注入。カウント / ハイライト / 撮影
  content/reveal.ts           非表示要素を clone 内で復帰させる
  content/inline-images.ts    別ドメイン画像の data URL 化
  background/main.ts          service worker。保存と画像取得
  offscreen/main.ts           大きな画像用の blob URL 生成
  shared/                     型とファイル名サニタイズ
vite.config.ts                popup / offscreen（ESM）
vite.config.content.ts        content script（IIFE 単一ファイル）
vite.config.background.ts     service worker（IIFE 単一ファイル）
test/sample.html              動作確認用ページ
```

### 実装メモ

- content script は `chrome.scripting.executeScript({ files })` で注入するため ESM が使えず、html2canvas ごと 1 ファイルの IIFE にバンドルしています。注入前に必ずバージョンを probe して、二重注入とコストを避けています。
- 常時アクセス権（`host_permissions`）は要求しません。通常は `activeTab` のみ、外部画像の取り込みだけ `optional_host_permissions` で必要時にリクエストします。
- `chrome.downloads` には URL 長 約 2MB の制限があるため、大きな画像は offscreen document で `blob:` URL に変換してから渡します。
- ファイル名は content script 側と service worker 側の両方でサニタイズし、ダウンロードフォルダ外への書き込みを防いでいます。

## ライセンス

依存している html2canvas は MIT License (© Niklas von Hertzen) です。
