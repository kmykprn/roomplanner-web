# 未解決事項

引き継ぎ時点で分かっているが直していないもの。**気づいた経緯と、どう確かめるかを残す**
のが目的。優先度は付けていないので、着手前に持ち主と相談すること。

対象は2つのリポジトリにまたがる。

- クライアント: https://github.com/kmykprn/roomplanner-web
- サーバー: https://github.com/kmykprn/Hunyuan3D-2GP

---

## サーバー（Hunyuan3D-2GP）

### 1. ワーカーのメモリ使用率が実機で未測定

PR #12 で `worker_entrypoint.py` の子プロセス起動を `subprocess.run` から `Popen` に
変えた。標準出力を1行ずつ読んで工程（`phase`）を `status.json` に書くため。

**理屈の上では従来より軽い。** 旧実装 `subprocess.run(stderr=PIPE)` は標準エラーの
全文をメモリに保持していたが、新実装は末尾200行しか残さない。読んだ行はその場で
素通しし、溜めない。

**しかし実機で測っていない。** 16GiB のうち 4GiB を gcsfuse のファイルキャッシュが
占めており余裕が少なく、過去に OOM（signal 9）を実際に踏んでいる箇所。

確かめ方: 実際に1件生成し、Cloud Run のメトリクスで `hunyuan3d-measure` の
コンテナメモリ使用率を見る。

### 2. 完了通知（`/internal/dispatch`）が2件目で効くか未確認

ワーカーの `_notify_dispatcher()` が生成完了時に API へ通知し、空いた GPU 枠で
次の待機ジョブを開始する。PR #13 で入った新しい経路。

**1件だけ試しても症状が出ない。** 通知に失敗しても生成結果は残り、次に
`GET /jobs/{id}` を叩いたときに `_dispatch_queued_jobs()` が枠を回収するため。

症状が出るのは**2件目を投げたとき**。いつまでも `queued` のままなら、ここが
失敗している。ワーカーのログに `_notify_dispatcher` の traceback が出る。

---

## クライアント（roomplanner-web）

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
