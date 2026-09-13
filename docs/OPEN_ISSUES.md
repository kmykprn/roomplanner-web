# 未解決事項

引き継ぎ時点で分かっているが直していないもの。**気づいた経緯と、どう確かめるかを残す**
のが目的。優先度は付けていないので、着手前に持ち主と相談すること。

対象は2つのリポジトリと、両方が乗っている GCP プロジェクトにまたがる。

- クライアント: https://github.com/kmykprn/roomplanner-web
- サーバー: https://github.com/kmykprn/Hunyuan3D-2GP

---

## 共通（GCPプロジェクト）

どちらのリポジトリのコードでもなく、コンソールでしか動かせないもの。

### 1. OAuth 同意画面が「テスト中」のまま

（内容は変わらない。以下は 2026-09-13 時点の補足）

`authDomain` を `kmykprn.github.io` に変えたことで、Google の同意画面に出る
「〜にログイン」の行は `project-….firebaseapp.com` ではなくアプリのドメインになる見込み。
本番公開の前に実機で見え方を確かめる。

Google ログインは使える状態になっている（プロバイダ有効、承認済みドメインに
`kmykprn.github.io` を追加済み、認証URIの発行まで実機で確認済み）。ただし
**公開ステータスが「テスト中」**なので、**テストユーザーに登録したアカウントしか
ログインできない**（上限100人）。

自分で動作確認するぶんには支障がない。**人に配る前に本番へ切り替える必要がある。**

切り替えようとすると、こう出て「アプリを公開」が押せない。

> To publish your app, you must complete your configuration on the Branding page.

ブランディングで空のままの項目があるため。公開に要るのは次の2つ。

| 項目 | 入れる値 |
|---|---|
| アプリケーションのホームページ | `https://kmykprn.github.io/roomplanner-web/` |
| プライバシーポリシー | `https://kmykprn.github.io/roomplanner-web/privacy.html` |

**ページが実在しないとまずい**（同意画面からリンクが張られる）。プライバシー
ポリシーはまだ無いので、**これが前提になる → 2**。

**承認済みドメインは2つあり、別物。** 手順0-2 で足したのは Firebase Authentication の
承認済みドメイン（ログインのリダイレクト先を許可するもの）で、ここで要るのは
OAuth 同意画面ブランディングの承認済みドメイン（同意画面から張るリンクの行き先を
許可するもの）。**前者に足しても後者には載らない。** 後者は Search Console での
ドメイン所有権確認を求められることがある。`github.io` は Public Suffix なので
`kmykprn.github.io` 単位で確認でき、Pages に確認用のファイルを置けば通せるはずだが、
**ひと手間増える前提でいること。**

**ロゴは上げないこと。** 上げると Google の審査対象になる。現在のスコープは基本3つ
だけなので、ロゴ無しなら審査は不要。利用規約は任意。

> 公開ステータスとテストユーザーの追加は、**どちらも API が無い**。
> Google Auth Platform のコンソールでしか操作できない。
> https://console.cloud.google.com/auth/audience?project=project-db31f07b-2895-48b8-8bb


### 2. 自前配信している Firebase 認証ヘルパーが古くなる

**iOS Safari でログインが止まる問題の根本原因は `authDomain` が別オリジンだったこと**
（`project-….firebaseapp.com` ≠ `kmykprn.github.io`）。Safari 16.1+ などはサードパーティの
保存領域を分断するため、ポップアップもリダイレクトも結果を持ち帰れない。
「`firebaseapp.com にログイン` と表示されて格好が悪い」問題も同じ原因だった。

対処として、Firebase が配るサインイン用ヘルパー 7 ファイルを
https://github.com/kmykprn/kmykprn.github.io の `/__/auth/` に**そのまま写して**配信し、
`authDomain` をアプリと同じオリジンにした（`src/config/api.ts`）。
根拠: https://firebase.google.com/docs/auth/web/redirect-best-practices

**残る運用上の弱点:**

- ヘルパーは取得時点のスナップショット。Google 側の修正（脆弱性対応を含む）は、
  同リポジトリの `Sync Firebase auth helper` ワークフローが**毎月1日に取り直す**。
  差分が無くても `LAST_CHECKED` を更新してコミットし、GitHub がスケジュールを止める
  「60 日間コミットなし」を避けている
- **Google がヘルパーの構成を変えて 7 ファイルでは足りなくなると、ログインは黙って失敗する。**
  自動化では検知できない。**月に一度は実機で Google ログインを試す**こと
- Apple サインインと SAML はこの方法では動かない（使っていない）

戻したくなったら `authDomain` を `project-db31f07b-2895-48b8-8bb.firebaseapp.com` に戻すだけ。
Google 側の配信は生きている。

---

## クライアント（roomplanner-web）

### 2. プライバシーポリシーのページが無い

**1 の前提。** 同意画面を本番に切り替えるには、実在するプライバシーポリシーの URL が要る。
**置き場所はこのリポジトリ。** `public/` に置いたものはビルドでそのまま配信されるので、
`public/privacy.html` にすれば `https://kmykprn.github.io/roomplanner-web/privacy.html`
で開ける。

書くべきこと（いずれも実装から確認できる事実）:

- 写真を Google Cloud（`asia-southeast1` / シンガポール）へ送り、3Dモデル生成に使う
- 入力画像と生成物は**30日で自動削除**される（`infra/storage.tf` の `lifecycle_rule`）。
  ただし消えるのは生成物バケットの中身だけで、**許可リスト（別バケットの
  `config/allowed_uids.json`）に登録した uid はこの30日ルールの外**。限定公開を
  やめるときに消すもの
- Google ログインで取得するのは `email` / `profile` / `openid` のみ
- 第三者提供はしない
- 連絡先

**Service Worker に食われないか確認すること。** `vite-plugin-pwa` は `generateSW` 方式で、
navigateFallback が `index.html` のままだと、PWA を入れた端末で `/privacy.html` を
開いてもアプリ本体が表示される。同意画面のリンクから飛んだ利用者がポリシーを読めない
（Google の審査クローラは Service Worker を持たないので影響しない）。ビルド後に
`dist/sw.js` を見て `navigateFallbackDenylist` の要否を判断する。

### 3. Firebase に到達できないと「取得中…」で止まり、ボタンは押せたまま

`src/ui/generationPanel.ts`:

```ts
void getUid()
  .then((uid) => { uidText.textContent = uid; })
  .catch(() => { authFailed = true; ... });
```

`getUid()` が**失敗ではなく解決も棄却もしない**まま止まると、`catch` が走らない。
利用者IDは「取得中…」のまま、作成ボタンは押せる状態で残る。押しても必ず失敗する。

壊れた鍵（形は正しいが無効な値）で開いて確認した挙動。**部屋の描画や未捕捉の例外は
起きない**ので、アプリ全体が落ちるわけではない。

なお「鍵が空のときにアプリ全体が起動しなくなる」件は既に対処済み
（`auth.ts` が `IS_CONFIGURED` を見て初期化を止める）。ここはそれとは別の穴。

直し方の案: `getUid()` に待ち時間を設け、超えたら「認証できませんでした」に倒す。

### 4. 生成した GLB が Cache Storage から消えない

`src/platform/modelCache.ts` に削除関数があるが、**どこからも呼ばれていない。**

```ts
/** 家具を消したときに中身も捨てる。GLBは1件4〜5MBあるので溜めない */
export async function deleteModel(key: string): Promise<void> {
```

家具を削除するとサムネイル（`deletePreview`）は消えるが、**GLB 本体は残り続ける。**
1件4〜5MB なので、作って消してを繰り返すと溜まる。コメントの意図どおりに
動いていない。

`src/ui/bottomSheet.ts` の削除ボタンで `deletePreview` と並べて呼べばよい。

### 5. Blob URL が解放されていない

`URL.createObjectURL` が3箇所にあるが、`URL.revokeObjectURL` は**0箇所**。

| 場所 | 用途 |
|---|---|
| `modelCache.ts:46` | GLB を three.js に渡す |
| `previewCache.ts:25` | 保存直後のサムネイル |
| `previewCache.ts:35` | 復元したサムネイル |

Blob URL はドキュメントが生きている限り元の Blob をメモリに固定する。
サムネイルは小さいが、**GLB は1件4〜5MB** なので効いてくる。

### 6. README の「今後の予定」が実態とずれている

引き継ぎ資料として誤解のもとになる。

- 「3. 部屋の保存（IndexedDB）と一覧画面」→ **オートセーブは localStorage で実装済み**
  （`src/core/persistence.ts`。リロードで復元されることを確認済み）
- 「4. 写真からの家具生成（S3 + FastAPI）」→ **GCS + Cloud Run で実装済み**

---

## 方針が決まっていないもの

### 7. Capacitor / App Store をやるかどうか

README の「今後の予定」5 に「Capacitor 8 で iOS アプリ化 → App Store」がある。
`vite.config.ts` にも Capacitor 向けのベースパス分岐が入っている。

**これが生きていると決済の設計が変わる。** App Store 経由で配ると、デジタル
コンテンツの課金はアプリ内課金が必須になり 15〜30% を取られる。Stripe を直接
使えるのはウェブ配信のときだけ。

無料回数と課金（`docs/LOGIN_PLAN.md` の順序4）に着手する前に決めること。

---

## 確認して解決したもの

記録として残す。**同じことを二度調べないため**と、確かめ方を再利用するため。

### ワーカーのメモリ使用率（旧 1）── ピーク 51%、余裕あり

PR #12 で `worker_entrypoint.py` の子プロセス起動を `subprocess.run` から `Popen` に
変えた。標準出力を1行ずつ読んで工程（`phase`）を `status.json` に書くため。過去に
OOM（signal 9）を踏んでいる箇所なので実測したかった。

**Cloud Monitoring で実測した結果、ピークで 51%。**

| | |
|---|---|
| 割り当て | 32GiB（8 CPU） |
| メモリ使用率のピーク | **51%**（p99, 5分間隔・18点） |
| 中央値のピーク | 49.5% |
| 実容量に直すと | 約 16.3GiB 使用 / 約 15.7GiB 空き |

`run.googleapis.com/container/memory/utilizations` を `hunyuan3d-measure` で
絞って取得。テクスチャ付き生成を4件流した区間を含む。

**内訳でも裏が取れる。** 16.3GiB のうち 4GiB は gcsfuse の in-memory キャッシュ
（`infra/job.tf` の `empty_dir { medium = "MEMORY", size_limit = "4Gi" }`）で、
残り約12GiB がアプリ側。これは 16GiB 割り当てだった頃の「キャッシュ4GiB＋アプリ約12GiB」
とほぼ同じ姿で、**当時はほぼ上限に張り付いていた**ことになる。32GiB にした判断の
裏付けでもある。

**測定で言えるのは「いまの割り当てに対して余裕がある」まで。** PR #12 の前後で
測り比べたわけではないので、**`Popen` 化で悪化していない根拠は測定ではなく実装のほうに
ある。** 旧実装 `subprocess.run(stderr=PIPE)` は標準エラーの全文をメモリに保持していたが、
新実装は末尾200行しか残さず、読んだ行はその場で素通しする。保持量が青天井から固定長に
変わっているので、悪化する経路が無い。

なお OPEN_ISSUES に「16GiB のうち 4GiB を gcsfuse が占めており余裕が少ない」と
書いてあったが、**現在の割り当ては 32GiB**（`infra/variables.tf` の
`job_memory`）。16GiB だったのは L4 の 4CPU 構成を試していた頃の話で、そのときは
実際に OOM を踏んだ。8CPU/32GiB に変えた時点で余裕ができている。

再測定するときのコマンド:

```bash
P=project-db31f07b-2895-48b8-8bb
curl -s -G -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  --data-urlencode 'filter=metric.type="run.googleapis.com/container/memory/utilizations" AND resource.labels.job_name="hunyuan3d-measure"' \
  --data-urlencode "interval.startTime=$(date -u -d '6 hours ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --data-urlencode "interval.endTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --data-urlencode "aggregation.alignmentPeriod=300s" \
  --data-urlencode "aggregation.perSeriesAligner=ALIGN_PERCENTILE_99" \
  "https://monitoring.googleapis.com/v3/projects/$P/timeSeries"
```

### 完了通知が2件目で効くか（旧 2）── 効いている

**3枚同時に投げて確認した。** 1件だけでは症状が出ない（通知が失敗しても
`GET /jobs/{id}` 側が枠を回収する）ので、待機が発生する状況を作った。

```
slot0: job_4df2bae14e784264  exec=98gj4  running
slot1: job_38316d76aaea492e  exec=6ln75  running
job_87bda098fb8b4310                     queued（枠の空き待ち）
```

枠は `queue/slots/` に `max_running_jobs` 本ぶんだけ作られる（既定2。
`api/main.py` の `_claim_global_slot` が `range(MAX_RUNNING_JOBS)` を回す）。
GPU は2本だけ立ち、3件目が待機。1件目が終わると**利用者が何もしなくても**
3件目が動き出した。

```
[11:15:00] 1件目=running    2件目=running  3件目=queued
[11:15:36] 1件目=succeeded  2件目=running  3件目=running (exec=5pq2f)
```

通知経路が実際に使われたことは API のアクセスログで裏が取れている。

```
11:15:11  200  Python-urllib/3.10   ← ワーカーからの完了通知
11:06:24  401  curl/7.81.0          ← 偽装を試したもの。正しく弾かれた
```

終了後は `queue/slots/` と `queue/pending/` がどちらも空になり、
回数も `{"count": 3, "attempts": 3}` と正しく計上された。
