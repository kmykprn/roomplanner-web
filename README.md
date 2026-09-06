# roomplanner-web

3D 部屋模様替えアプリ。[roomplanner-v4](https://github.com/kmykprn/roomplanner-v4)（Expo + React Native + React Three Fiber）を、
**React を使わず Vite + TypeScript + three.js で書き直したもの**。

React の宣言的レンダリングを 3D シーングラフに被せることをやめ、
「触りたいオブジェクトを直接触る」書き方に戻すことで、コード量と見通しの改善を狙う。

## 現在の状態（プロトタイプ）

動くもの:

- 部屋の描画（床 + 壁 4 枚、v4 の座標系仕様を踏襲）
- カメラ操作（1 本指ドラッグで回転 / 2 本指ピンチでズーム / 2 本指ドラッグでパン）
- 手前側の壁の自動透過
- 家具の追加・タップ選択・ドラッグ移動・回転・削除
- 家具を追加するとき、既存の家具に重ならない位置を自動で選ぶ

未実装: GLB モデルの読み込み、窓 / ドア / カーテン、床・壁のデザイン変更、
部屋の保存と一覧、写真からの家具生成（S3 + FastAPI 連携）、PWA 化、Capacitor による iOS 配信。

## セットアップ

```bash
npm install
npm run dev        # http://localhost:5173
```

### スマホの実機で確認する

`npm run dev` は `--host` 付きで起動するので、ターミナルに出る
`Network: http://192.168.x.x:5173/` を **同じ Wi-Fi につないだスマホのブラウザ**で開くだけ。
コードを保存すると即座に反映される。Expo Go のようなアプリのインストールは不要。

### その他のコマンド

```bash
npm run build      # 型チェック + 本番ビルド（dist/）
npm run preview    # ビルド結果をローカルで確認
npm run typecheck  # 型チェックのみ
```

## ディレクトリ構成

```
src/
  config/       仕様と定数。座標系・カラーテーマ・家具の種類
  core/         土台。状態管理と three.js のセットアップ
  scene/        3D オブジェクトの生成（部屋・照明・家具）
  interaction/  ユーザー操作（カメラ・壁の透過・家具のドラッグ）
  ui/           DOM の UI。3D とは完全に分離している
  platform/     ネイティブ依存の隔離層（後述）
  main.ts       組み立て。ここを読めば全体の流れが分かる
```

## v4 からの主な変更点

### 状態管理

zustand の store 9 個（約 1,000 行）を、37 行の `core/store.ts` と
1 つの `core/appState.ts` に置き換えた。

React には「状態が変わったら再レンダリングする」仕組みが必要だが、
three.js のオブジェクトは直接書き換えられるので、
必要なのは「変わったことを知らせる」購読だけになる。

### 壁の自動透過

`utils/wallVisibilitySystem.ts`（283 行）→ `interaction/wallVisibility.ts`（55 行）。

v4 は React にカメラの状態を渡すために球面座標を保持しており、
壁の判定のたびに三角関数からカメラ位置を再計算していた。
three.js を直接使えば `camera.position` がすでに答えなので、
壁の法線との内積 1 回で判定できる。

### ジェスチャー

`react-native-gesture-handler` + `react-native-reanimated` →
ブラウザ標準の Pointer Events。追加ライブラリなし。

### コード量

| | v4 | 現在 |
|---|---|---|
| 依存パッケージ | 40 以上 | 3（three / typescript / vite） |
| 本番バンドル | — | 約 490KB（gzip 約 125KB） |
| src 合計 | 23,533 行（全機能） | 1,094 行（プロトタイプ範囲） |

機能の範囲が違うので単純比較はできない。同じ機能どうしの比較は上記 2 つを参照。

## 設計上の約束ごと

### すべての 3D オブジェクトは底面基準

高さ h のオブジェクトは、メッシュを `y = h/2` に置き、
グループの原点が底面に来るようにする。
こうすると配置時の `position.y` が「床からの高さ」そのものになり、
`y = 0` が床置きを意味する。v4 の仕様をそのまま引き継いでいる。

### 壁の定義は 1 箇所に集約する

壁の位置・回転・法線は `config/room.ts` の `getWallTransform()` だけが知っている。
描画（`scene/room.ts`）も透過判定（`interaction/wallVisibility.ts`）もここを参照するので、
部屋の形を変えるときに直す場所が 1 つで済む。

### ネイティブ依存は `src/platform/` に隔離する

将来 Capacitor で iOS アプリにするとき、差し替えが必要になるのは
カメラ・写真ライブラリ・ファイル保存といった OS 依存の部分だけ。
これらを `platform/` の関数越しにしか呼ばないようにしておけば、
差し替えは 1 ファイルの中で完結する。

`platform/picker.ts` は現時点でまだ呼び出し元がない（家具作成画面が未実装のため）。
この方針を先に決めておくためのもので、写真取り込みを実装する際にここから使う。

## 今後の予定

1. GLB モデルの読み込み（v4 のアセットをそのまま流用）
2. 窓 / ドア / カーテンなど壁固定オブジェクト
3. 部屋の保存（IndexedDB）と一覧画面
4. 写真からの家具生成（S3 + FastAPI）
5. PWA 化 — ホーム画面に追加して全画面で使えるようにする
6. Capacitor 8 で iOS アプリ化 → App Store

### 5 以降の注意点

- **オフラインで起動できること。** ネット断で白画面になる WebView アプリは
  App Store のガイドライン 4.2（最低限の機能）で弾かれる。
  データは端末内に持ち、起動時にサーバーを必要としない設計を保つ。
- **Xcode 26 / iOS 26 SDK が必須。** 2026 年 4 月 28 日以降、
  これより古いツールチェーンでビルドしたバイナリは App Store Connect が受け付けない。
  Capacitor は 8 系を使うこと（7 系は Xcode 16 前提）。
- **FastAPI 側の CORS に `capacitor://localhost` を追加すること。**
  Capacitor アプリ内の WebView はこのオリジンから通信する。
  また iOS の ATS により、API サーバーは HTTPS である必要がある。
