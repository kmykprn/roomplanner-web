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
 * **apiKey は秘密情報ではない。** これは「どのFirebaseプロジェクトか」を
 * 示す宛先で、認証情報ではない。これで作れるのは匿名アカウントだけで、
 * そのuidが許可リストに無ければAPIは403を返す。
 *
 * 実際に守っているのは、
 *   1. Firebase が署名したIDトークン（偽造できない）
 *   2. サーバー側の許可リスト（GCSにあり、ここからは触れない）
 * であって、この値を隠すことではない。
 */
export const FIREBASE_CONFIG = {
  apiKey: 'PLACEHOLDER_SET_BEFORE_DEPLOY',
  authDomain: 'project-db31f07b-2895-48b8-8bb.firebaseapp.com',
  projectId: 'project-db31f07b-2895-48b8-8bb',
};

/**
 * 生成の所要時間。実測で約502秒（8分22秒）。
 * 画面の案内文とポーリング間隔の根拠にする。
 */
export const EXPECTED_DURATION_SECONDS = 502;

/** 状態を見に行く間隔。生成が8分かかるので、細かく叩く意味がない */
export const POLL_INTERVAL_MS = 15_000;

/** これを超えたら見に行くのをやめる。生成時間の3倍あれば十分 */
export const POLL_TIMEOUT_MS = 30 * 60 * 1000;
