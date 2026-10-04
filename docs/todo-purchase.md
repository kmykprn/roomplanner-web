# 残りの作業: 回数券の App Store での購入

「家具を追加」の帯の［購入］を押すと、回数券の一覧（`src/ui/ticketSheet.ts`）が出る。
今は一覧と価格を出して「購入は準備中です。」と書いているだけで、買えない。ここに残りの作業を書く。

## 今できていること

- サーバー（Hunyuan3D-2GP）
  - `POST /wallet/purchases/apple` が、StoreKit 2 の署名付き取引（`Transaction.jwsRepresentation`）を受け取り、
    Apple のルート証明書まで署名をたどって確かめてから、回数を足す（`api/apple.py`、`api/main.py`）
  - 取引の `appAccountToken` が送り主の利用者と一致しなければ受け付けない。値は `GET /wallet` の `accountToken`
  - 返金の通知（App Store Server Notifications）で回数を引く
  - 商品 ID と回数: `io.github.kmykprn.roomplanner.credits10` / `credits30` / `credits80` → 10 / 30 / 80 回
- アプリ
  - 帯（`src/ui/walletBar.ts`）と回数券の一覧（`src/ui/ticketSheet.ts`）、商品の一覧（`src/config/tickets.ts`）

## 残りの作業

### App Store Connect（利用者・Mac が要る）

- [ ] 有料アプリの契約（Paid Apps Agreement）を結ぶ
- [ ] 消耗型の商品を 3 つ作る（ID は上と同じ。価格 120 円 / 300 円 / 600 円）
- [ ] Sandbox のテスト用アカウントを作る
- [ ] App Store Server Notifications の送り先にサーバーの通知の URL を入れる（返金を引くため）
- [ ] 本番で配るとき、サーバーの `APPLE_APP_ID`（App Store Connect のアプリ ID、数字）を入れる。入れるまでは Sandbox の取引だけを受け付ける

### アプリ（このリポジトリ）

- [ ] StoreKit 2 を呼ぶ小さな Capacitor のプラグインを Swift で作る（`ios/App/App/`。外部のライブラリは使わない）
  - 商品の取得（`Product.products(for:)`）。表示する価格は StoreKit が返す地域の価格にする（`src/config/tickets.ts` の円は仮の写し）
  - 購入（`product.purchase(options: [.appAccountToken(uuid)])`）。`uuid` は `GET /wallet` の `accountToken`
  - 結果の `jwsRepresentation` を返し、サーバーが受け付けたあとで `transaction.finish()` する
  - 途中で止まった取引（`Transaction.unfinished`）と、後から届く取引（`Transaction.updates`、承認待ちなど）を、
    アプリの起動時に拾ってサーバーに送り直す
- [ ] `src/platform/purchase.ts` を作る（OS 依存の処理は `src/platform/` 経由。CLAUDE.md）。Web では「買えない」を返す
- [ ] 回数券の一覧に買うボタンを付ける。アプリ版は各行を押すと購入、Web 版は「アプリで購入できます」と出し、買うボタンは出さない
- [ ] 買い終わったら、`refreshWallet()` で帯の回数を取り直す
- [ ] 購入の失敗・取り消し・承認待ち（ファミリー共有の「承認と購入のリクエスト」）の文言を決める
- [ ] Playwright のテスト（購入の部分は偽物に差し替える）と、iPhone の実機での Sandbox 購入の確認

### 注意

- 私（Claude）の環境では iOS 用の部分を組み立てられない。Swift の部分は Mac の Xcode で組み立てて確かめる必要がある
- Web 版で App Store 以外の決済を出すと、App Store の審査の決まりに触れることがある（アプリ内のデジタル商品は App 内課金のみ）
