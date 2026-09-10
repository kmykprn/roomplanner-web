# roomplanner-web

3D 部屋模様替えアプリ。[roomplanner-v4](https://github.com/kmykprn/roomplanner-v4)（Expo + React Native + React Three Fiber）を、
**React を使わず Vite + TypeScript + three.js で書き直したもの**。

React の宣言的レンダリングを 3D シーングラフに被せることをやめ、
「触りたいオブジェクトを直接触る」書き方に戻すことで、コード量と見通しの改善を狙う。

**公開URL: https://kmykprn.github.io/roomplanner-web/**

## 現在の状態（プロトタイプ）

動くもの:

- 部屋の描画（床 + 壁 4 枚、v4 の座標系仕様を踏襲）
- カメラ操作（1 本指ドラッグで回転 / 2 本指ピンチでズーム / 2 本指ドラッグでパン）
- 手前側の壁の自動透過
- 家具の追加・タップ選択・ドラッグ移動・回転・削除
- 家具を追加するとき、既存の家具に重ならない位置を自動で選ぶ
- 写真を複数選択して3D家具を作成し、完了したものから部屋へ自動配置
- 作成中と配置済みの家具で、元写真の縮小プレビューとファイル名を確認

PWA として動くので、ホーム画面に追加すればアドレスバーなしの全画面で、
オフラインでも起動する。

未実装: 窓 / ドア / カーテン、床・壁のデザイン変更、部屋の保存と一覧、
Capacitor による iOS 配信。

## セットアップ

```bash
npm install
npm run dev        # http://localhost:5173
```

### スマホで使う（公開版）

https://kmykprn.github.io/roomplanner-web/ をスマホのブラウザで開く。

ホーム画面に追加すると、アプリのように全画面で起動する:

- **iOS (Safari)** … 共有ボタン → 「ホーム画面に追加」
- **Android (Chrome)** … メニュー → 「アプリをインストール」

一度開いておけば、次からは**オフラインでも起動する**（Service Worker がキャッシュする）。

### スマホの実機で確認する（開発中）

`npm run dev` は `--host` 付きで起動するので、ターミナルに出る
`Network: http://192.168.x.x:5173/` を **同じ Wi-Fi につないだスマホのブラウザ**で開くだけ。
コードを保存すると即座に反映される。Expo Go のようなアプリのインストールは不要。

### その他のコマンド

```bash
npm run build      # 型チェック + 本番ビルド（dist/）
npm run preview    # ビルド結果をローカルで確認
npm run typecheck  # 型チェックのみ
```

## デプロイ

main に push すると GitHub Actions が自動でビルドして GitHub Pages に公開する
（`.github/workflows/deploy.yml`）。手動での操作は不要。

GitHub Pages はリポジトリ名のサブパス（`/roomplanner-web/`）配下で配信されるため、
ワークフローは `DEPLOY_BASE=/roomplanner-web/` を指定してビルドしている。
既定のベースパスは `./`（相対パス）で、これは将来 Capacitor でネイティブアプリに
包むときに必要になる。

### 初回のみ必要な設定

リポジトリの **Settings → Pages → Source** を **GitHub Actions** に変更する。
これをしないとワークフローがデプロイ段階で失敗する。

### アイコンを変更する

`assets-src/icon.svg` を編集して、ファイル先頭のコメントにあるコマンドを実行する。
生成された PNG は `public/` にコミットする。

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

public/         そのまま配信される静的ファイル（アイコン類）
assets-src/     アイコンの元データと生成スクリプト
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
| 依存パッケージ | 40 以上 | 4（three / typescript / vite / vite-plugin-pwa） |
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

進行中の作業には手順書がある。着手前にそちらを読むこと。

- [docs/LOGIN_PLAN.md](docs/LOGIN_PLAN.md) — Google ログインの導入手順。
  匿名認証のままではサイトデータを消した時点で uid ごと消えるため、
  保管機能（家具一覧・部屋のサーバー保存）より先に入れる
- [docs/OPEN_ISSUES.md](docs/OPEN_ISSUES.md) — 分かっているが直していないもの。
  実機で確かめる必要があるもの、方針が決まっていないものを含む

1. GLB モデルの読み込み（v4 のアセットをそのまま流用）
2. 窓 / ドア / カーテンなど壁固定オブジェクト
3. 部屋の保存（IndexedDB）と一覧画面
4. 写真からの家具生成（S3 + FastAPI）
5. Capacitor 8 で iOS アプリ化 → App Store

### iOS 配信時の注意点

- **オフラインで起動できること。** ネット断で白画面になる WebView アプリは
  App Store のガイドライン 4.2（最低限の機能）で弾かれる。
  現状は Service Worker でこの条件を満たしているので、
  起動時にサーバーを必要とする設計に変えないこと。
- **Xcode 26 / iOS 26 SDK が必須。** 2026 年 4 月 28 日以降、
  これより古いツールチェーンでビルドしたバイナリは App Store Connect が受け付けない。
  Capacitor は 8 系を使うこと（7 系は Xcode 16 前提）。
- **FastAPI 側の CORS に `capacitor://localhost` を追加すること。**
  Capacitor アプリ内の WebView はこのオリジンから通信する。
  また iOS の ATS により、API サーバーは HTTPS である必要がある。
