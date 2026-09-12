# 作業手順書: 知り合いだけに配る（Google ログイン＋メールで許可）

自分と知り合いだけが 3D モデルを作れる状態にするための、**手元の端末で行う**作業。
リポジトリ側の実装は済んでいる（roomplanner-web #36 #37、Hunyuan3D-2GP #19 #20）。
残っているのは GCP・GitHub の設定と、実機での確認だけ。

OAuth 同意画面は「テスト」のままで進める。知り合いは 1 人ずつテストユーザーに登録する
（上限 100 人）。「本番」にするのは人に広く配るときで、その前に privacy.html が要る
（`docs/OPEN_ISSUES.md` の 1・2）。

## 前提

- 手元の端末に `gcloud`（ログイン済み）と `terraform` がある。無ければ
  `Hunyuan3D-2GP/infra/HANDOFF.md`「インフラを触るなら」のとおりに入れる
- `Hunyuan3D-2GP` と `roomplanner-web` を clone してあり、両方 main が最新
- `Hunyuan3D-2GP/infra/terraform.tfvars` がある（無ければ HANDOFF.md「terraform.tfvars を用意する」）
- iPhone（Safari）と、2 台目として PC のブラウザ

固定値:

| | |
|---|---|
| GCP プロジェクト | `project-db31f07b-2895-48b8-8bb` |
| 公開サイト | https://kmykprn.github.io/roomplanner-web/ |
| 設定バケット | `gs://project-db31f07b-2895-48b8-8bb-hunyuan3d-config/config/` |
| API のリポジトリ | https://github.com/kmykprn/Hunyuan3D-2GP |

順番は A → B → C → D → E → F。B が終わるまでメールでの許可は効かない。

---

## A. テストユーザーを登録する（GCP コンソール）

同意画面が「テスト」のあいだ、ここに無いアカウントは Google のログイン画面で弾かれる。

1. GCP コンソール → **Google Auth Platform** → **対象（Audience）**（旧「OAuth 同意画面」）
2. **テストユーザー** → **Add users** に、自分の Gmail と知り合いの Gmail を入れて保存
3. 公開ステータスは「テスト」のまま。**ロゴは上げない**（上げると Google の審査になる）

終了条件: 自分のメールがテストユーザーに載っている。

---

## B. API をデプロイできるようにして、いまの main を本番に乗せる

GitHub Actions が GCP に入る入口を Terraform で作り、その出力を GitHub に登録する。
以後は `api/` の変更が main にマージされるたびに自動でデプロイされる。

```bash
cd Hunyuan3D-2GP/infra
terraform init
terraform plan
```

**plan の差分が次の追加だけ**であることを確認する。それ以外（既存のサービスやバケットの変更・削除）が
出たら apply せずに止まる。tfvars に `public_access = true`・`image`・`api_image` が
入っていないと、入口が閉じて SPA が全部落ちる（HANDOFF.md の注意）。

- `google_iam_workload_identity_pool.github`
- `google_iam_workload_identity_pool_provider.github`
- `google_service_account.deployer`
- `google_service_account_iam_member.github_impersonates_deployer`
- `google_artifact_registry_repository_iam_member.deployer_pushes_images`
- `google_cloud_run_v2_service_iam_member.deployer_updates_api[0]`
- `google_service_account_iam_member.deployer_acts_as_api`
- `google_project_service.required["sts.googleapis.com"]`

```bash
terraform apply
terraform output deploy_workload_identity_provider
terraform output deploy_service_account
```

出た 2 つの値を GitHub の **Hunyuan3D-2GP** → Settings → Secrets and variables → Actions → **Variables** に入れる。

| 変数名 | 値 |
|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/…/locations/global/workloadIdentityPools/github/providers/github` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `hunyuan3d-deployer@project-db31f07b-2895-48b8-8bb.iam.gserviceaccount.com` |

そのあと GitHub の Actions タブ → **Deploy API** → **Run workflow**（main）。
`test` → `deploy` の順に緑になり、最後の「新しいリビジョンが応答するか」で `401` が出れば完了。

終了条件: ワークフローが緑。Cloud Run の `hunyuan3d-api` のイメージが `api:sha-…` になっている。

---

## C. メールで許可する

B が終わると、`config/allowed_emails.json` に載っているメールの人は利用者ID を登録しなくても通る。

```bash
C=gs://project-db31f07b-2895-48b8-8bb-hunyuan3d-config/config
gcloud storage cat $C/allowed_emails.json 2>/dev/null || echo '（まだ無い）'
cat > /tmp/allowed_emails.json <<'EOF'
["自分@gmail.com", "知り合い@gmail.com"]
EOF
gcloud storage cp /tmp/allowed_emails.json $C/allowed_emails.json
```

- 大文字小文字は区別しない。60 秒で効く。再デプロイは要らない
- 既存の `allowed_uids.json` はそのまま残す（匿名のままの人はそちらでしか通らない）

終了条件: `gcloud storage cat $C/allowed_emails.json` に自分のメールが出る。

---

## D. 実機で確認する（iPhone Safari）

Claude のブラウザ確認は Firebase の認証を偽装して動かしているため、**本物の Google ログインは
一度も通っていない**。ここは実機で見るしかない。

1. Safari で https://kmykprn.github.io/roomplanner-web/ を開く。以前に開いたことがあれば、
   いったんタブを閉じて開き直す（新しい版を読ませる）
2. 「3Dモデル」タブ → 「利用者ID」を開き、**ログイン前の uid を控える**（長押しでコピー）
3. 作成ボタンの下に「作成には Google ログインが必要です」と出ていることを見る
4. 「＋ 写真から3Dモデルを作成」→ 写真を 1 枚選ぶ
5. ログインを求めるパネルが出る。「Google でログイン」を押す
6. Google のログイン画面（ポップアップまたは別タブ）で、A で登録したアカウントを選ぶ
7. 戻ってきたら、選んだ写真でそのまま作成が始まる（「作ったモデル」に円が出る）
8. 「利用者ID」を開き、**ログイン後の uid が 2 と同じ**ことを見る

| 見ること | 期待 | 違ったら |
|---|---|---|
| 6 でログイン画面が出る | 出る | 出ない・すぐ閉じる → パネルに理由が出る。その文言を控える |
| 8 の uid | 2 と同じ | **違う → ここで止めて報告。** 昇格ではなくログインし直しが走っている |
| 7 の作成 | 始まる | 「このアカウントはまだ利用できない」→ C のメールが間違っているか B が未完 |
| 作成の完了 | 約 8 分後に「作ったモデル」に並ぶ | 8 分半を超えても円が止まったまま → 報告 |

作成は 1 回あたり約 39 円の GPU 実費がかかる。確認は 1 回でよい。

9. Safari を閉じてもう一度開き、「利用者ID」が同じで、「ログインが必要」の一行が出ていないことを見る

終了条件: uid がログイン前後で同じ。作成が始まり、完了したモデルが並ぶ。

---

## E. 2 台目で確認する（PC のブラウザ）

同じ Google アカウントで別の端末から入ると、**同じ uid** に戻れることを見る。

1. PC のブラウザで公開サイトを開き、「利用者ID」を控える（iPhone とは別の匿名 uid のはず）
2. 「＋ 写真から3Dモデルを作成」→ 写真を選ぶ → 「Google でログイン」→ D と同じアカウント
3. 「利用者ID」を見る。**iPhone の uid と同じ**になっていれば正しい（この端末の匿名 uid は捨てられる）
4. 作成は始まってしまうので、費用を避けたければ 2 の写真選択の前に一度「やめる」で試してもよい。
   ログインだけ試すなら、パネルで「Google でログイン」→ 成功 → 作成が始まる、の流れは止められないので、
   1 回分の費用は見込んでおく

終了条件: 2 台目の uid が iPhone の uid と一致。

---

## F. 知り合いに配る

相手に送るもの:

- 公開サイトの URL
- 「写真を選んだあとに Google ログインを求められるので、こちらに伝えた Gmail でログインしてください」
- ログイン画面で「このアプリは Google の確認プロセスを完了していません」と出たら、
  テストユーザーに登録した Gmail と違うアカウントを選んでいる

相手の Gmail は A（テストユーザー）と C（allowed_emails.json）の**両方**に入れる。片方だけだと、
A だけ → 403「このアカウントはまだ利用できない」、C だけ → Google のログイン画面で弾かれる。

---

## 報告テンプレ

```
A テストユーザー登録: 済 / 未（登録したメール: …）
B デプロイ: 緑 / 失敗（失敗したステップ: …）
C allowed_emails.json: 済（… 件）
D iPhone:
   ログイン前 uid: …
   ログイン後 uid: …（同じ / 違う）
   ログイン画面: 出た / 出なかった（パネルの文言: …）
   作成: 始まった / 始まらない（文言: …）、完了: 済 / 未
E 2台目: uid 一致 / 不一致（2台目のログイン前 uid: …）
気づいたこと: …
```

## 困ったとき

| 症状 | 見る場所 |
|---|---|
| パネルに「このサイトからはログインできない設定」 | Firebase Console → Authentication → Settings → 承認済みドメインに `kmykprn.github.io` があるか |
| パネルに「ポップアップを許可して…」 | Safari の設定 → ポップアップブロック。iPhone では Safari が別タブで開くことが多く、通常は出ない |
| Google 側で「確認プロセスを完了していません」 | A に登録していないアカウント |
| 403「このアカウントはまだ利用できない」 | C のメールの綴り。B が終わっていなければメールは見られない（uid の一覧だけ） |
| Deploy API の `deploy` が auth で失敗 | GitHub Variables の 2 つ。値は `terraform output` の出力そのまま |
