/**
 * 3Dモデル生成APIの接続先。
 *
 * ここに書いた値は**ビルドすると公開される**（クライアントに配るJSに入る）。
 * それを前提にしてよい理由は下記のとおりで、隠す仕組みは入れない。
 * 隠したつもりになるほうが危険なので、公開される前提を明示しておく。
 */

/** 生成APIの入口。詳細は Hunyuan3D-2GP の api/SPEC.md */
export const API_BASE = 'https://hunyuan3d-api-yvl3t4jpxa-as.a.run.app';

/**
 * Firebase の設定。
 *
 * ## apiKey はリポジトリに置かない。ただし秘密でもない
 *
 * **この値はビルド後のJSに必ず入り、アプリを開けば誰でも読める。**
 * リポジトリから外しても秘密にはならない。そこは誤解しないこと。
 *
 * それでもビルド時に注入するのは、秘密にするためではなく次の3つのため。
 *
 *   1. **アラート疲れを避ける。** GitHub のシークレットスキャンは
 *      Google APIキーを必ず誤検知として鳴らす。「Google API Key exposed」を
 *      無視する習慣がつくと、いつか本物を見逃す
 *   2. **git 履歴に残さない。** 鍵を差し替えても、コミットした値は
 *      フォークやクローンに残り続ける。ローテーションしやすくしておく
 *   3. **置き場所を先に作る。** App Check のデバッグトークンなど、
 *      本当の秘密があとから出てきたときに困らない
 *
 * 実際に守っているのは、
 *   1. Firebase が署名したIDトークン（偽造できない）
 *   2. サーバー側の許可リスト（GCSにあり、ここからは触れない）
 * であって、この値の隠し方ではない。詳細は Hunyuan3D-2GP の api/SECURITY.md。
 */
export const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: 'project-db31f07b-2895-48b8-8bb.firebaseapp.com',
  projectId: 'project-db31f07b-2895-48b8-8bb',
};

/**
 * 設定が入っているか。
 *
 * 空のまま起動すると Firebase は「api-key-not-valid」で失敗するが、
 * その文言からは「設定を忘れた」のか「鍵が失効した」のかが分からない。
 * 呼び出し側でここを見て、原因の分かる案内を出す。
 */
export const IS_CONFIGURED = FIREBASE_CONFIG.apiKey.length > 0;

/**
 * 生成の所要時間。実測で約502秒（8分22秒）。
 * 画面の案内文とポーリング間隔の根拠にする。
 */
export const EXPECTED_DURATION_SECONDS = 502;

/** 状態を見に行く間隔。生成が8分かかるので、細かく叩く意味がない */
export const POLL_INTERVAL_MS = 15_000;

/** これを超えたら見に行くのをやめる。生成時間の3倍あれば十分 */
export const POLL_TIMEOUT_MS = 30 * 60 * 1000;
