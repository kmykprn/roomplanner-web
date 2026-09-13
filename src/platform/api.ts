/**
 * 生成APIとの通信をこの 1 ファイルに隔離する。
 *
 * 呼び出し側は fetch も HTTP の状態コードも知らない。
 * 差し替えるときにここだけ見ればよくするため。
 *
 * API の取り決めは Hunyuan3D-2GP の api/SPEC.md にある。
 */

import { API_BASE, CUTOUT_BASE, CUTOUT_TIMEOUT_MS } from '@/config/api';
import { getIdToken } from '@/platform/auth';

/** 生成の進み方。サーバー側の state をそのまま写している */
export type JobState = 'queued' | 'running' | 'succeeded' | 'failed';

export interface JobStatus {
  state: JobState;
  /**
   * いまサーバーが何をしているか。
   *
   * **無いことがある。** サーバーは工程の書き込みに失敗しても生成を続けるので、
   * 8分間ずっと来ないこともありうる。値の一覧は api/SPEC.md
   */
  phase?: string;
  /**
   * その工程に入ってからの経過秒。**サーバー側で引いた値**。
   *
   * 時刻ではなく経過秒を受け取るのは、端末の時計のずれを持ち込まないため
   */
  phaseElapsedSeconds?: number;
  /** 完成した GLB の場所。succeeded のときだけ入る。1時間で切れる */
  modelUrl?: string;
  /** failed のときの理由 */
  error?: string;
}

/**
 * 生成を頼めなかったときのエラー。
 *
 * 状態コードごとに文言を分けるのは、利用者が次に何をすればよいかが
 * まったく違うため（待つ／画像を変える／明日にする／登録を頼む）。
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function authHeaders(): Promise<HeadersInit> {
  return { Authorization: `Bearer ${await getIdToken()}` };
}

/** サーバーが返す理由を拾う。無ければ状態コードから文言を組む */
async function toApiError(response: Response): Promise<ApiError> {
  let detail = '';
  try {
    detail = (await response.json()).detail ?? '';
  } catch {
    // 本文が JSON でないこともある（プロキシが返す502など）
  }
  const fallback: Record<number, string> = {
    401: '認証が切れました。ページを開き直してください',
    403: 'このアカウントはまだ生成を使えません',
    409: 'いま別の生成が動いています。終わるまで待ってください',
    429: '本日の上限に達しました',
  };
  return new ApiError(response.status, detail || fallback[response.status] || '生成を頼めませんでした');
}

/**
 * 切り抜きが頼めなかったときの文言。3D 生成とは状況が違う（待機列も許可リストも無い）ので分ける。
 *
 * サーバーの detail は運用者向けの言い方なので、利用者には状態コードごとの文言を出す
 */
function toCutoutError(response: Response): ApiError {
  const messages: Record<number, string> = {
    400: 'この写真は読み込めませんでした。別の写真を試してください',
    401: 'Google ログインが必要です。ログインしてからもう一度お試しください',
    409: '同時に処理されました。もう一度お試しください',
    429: '本日の切り抜きの上限に達しました',
  };
  return new ApiError(response.status, messages[response.status] ?? '切り抜けませんでした。時間をおいて試してください');
}

/**
 * 画像を送って生成を頼む。返るのは受付番号だけで、完成はしていない。
 *
 * @returns jobId。以後この番号で状態を見に行く
 */
export async function createJob(image: Blob): Promise<string> {
  const body = new FormData();
  // 拡張子はサーバー側の判定に使われない（中身をデコードして判定している）が、
  // 付けないと一部のブラウザが filename を空にして multipart が崩れる
  body.append('image', image, 'photo.jpg');

  const response = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: await authHeaders(),
    body,
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()).jobId;
}

/** いまどこまで進んだかを見る */
export async function getJob(jobId: string): Promise<JobStatus> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
    headers: await authHeaders(),
  });
  if (!response.ok) throw await toApiError(response);
  return response.json();
}

/**
 * 写真を送って、家具だけを切り抜いた透過 PNG を受け取る。数秒で返る。
 *
 * 待つ上限を置く。サーバー側にも 60 秒の打ち切りがあるが、通信が途中で
 * 切れたときは応答そのものが来ないので、こちらでも切る
 */
export async function createCutout(image: Blob): Promise<Blob> {
  const body = new FormData();
  body.append('image', image, 'photo.jpg');

  const response = await fetch(`${CUTOUT_BASE}/cutouts`, {
    method: 'POST',
    headers: await authHeaders(),
    body,
    signal: AbortSignal.timeout(CUTOUT_TIMEOUT_MS),
  });
  if (!response.ok) throw toCutoutError(response);
  return response.blob();
}
