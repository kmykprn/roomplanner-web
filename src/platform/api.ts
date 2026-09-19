/**
 * 生成APIとの通信をこの 1 ファイルに隔離する。
 *
 * 呼び出し側は fetch も HTTP の状態コードも知らない。
 * 差し替えるときにここだけ見ればよくするため。
 *
 * API の取り決めは Hunyuan3D-2GP の api/SPEC.md にある。
 */

import { API_BASE, CUTOUT_BASE, CUTOUT_WAIT_SECONDS } from '@/config/api';
import type { Engine } from '@/core/engine';
import { getIdToken } from '@/platform/auth';
import { isNativeApp } from '@/platform/native';

/** 生成の進み方。サーバー側の state をそのまま写している */
export type JobState = 'queued' | 'running' | 'succeeded' | 'failed';

export interface JobStatus {
  state: JobState;
  /** どのモデルで作っているか。工程表がこれで変わる。古いサーバーは返さない */
  engine?: Engine;
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
    401: 'ログインの有効期限が切れました。アプリを開き直してください',
    403: 'このアカウントではまだ 3D モデルを作れません',
    409: '別の 3D モデルを作成中です。終わってからお試しください',
    429: '今日の作成回数の上限に達しました。明日またお試しください',
  };
  // 残高切れはサーバーの理由（運用者向けの言い方）ではなく、画面の文言（core/wallet.ts と対）で出す
  if (response.status === 402) return new ApiError(402, NO_CREDITS_MESSAGE);
  return new ApiError(response.status, detail || fallback[response.status] || '3D モデルの作成を始められませんでした。時間をおいてお試しください');
}

/** 3D を作る回数（お試し・回数券）を使い切ったときの文言。券の購入はアプリ版に入る予定（段階 2） */
export const NO_CREDITS_MESSAGE = isNativeApp
  ? '3D モデルを作る回数を使い切りました。回数券は準備中です'
  : '3D モデルを作る回数を使い切りました。回数券はアプリ版で買えるようになる予定です';

/** 財布。詳細は Hunyuan3D-2GP の api/SPEC.md（GET /wallet） */
export interface Wallet {
  /** 回数券の残り。期限なし */
  credits: number;
  /** お試しの残り。アカウントの生涯で 3 回 */
  trialRemaining: number;
  /** 「バナーなし」を買い切っているか */
  noBanner: boolean;
}

/** 3D を作れる残りの回数を見る */
export async function getWallet(): Promise<Wallet> {
  const response = await fetch(`${API_BASE}/wallet`, {
    headers: await authHeaders(),
  });
  if (!response.ok) throw await toApiError(response);
  return response.json();
}

/**
 * 切り抜きが頼めなかったときの文言。3D 生成とは状況が違う（待機列も許可リストも無い）ので分ける。
 *
 * サーバーの detail は運用者向けの言い方なので、利用者には状態コードごとの文言を出す
 */
function toCutoutError(response: Response): ApiError {
  const messages: Record<number, string> = {
    400: 'この写真は読み込めませんでした。別の写真をお試しください',
    401: 'Google ログインが必要です。ログインしてからもう一度お試しください',
    409: '処理が重なりました。もう一度お試しください',
    429: '今日の切り抜き回数の上限に達しました。明日またお試しください',
    503: '切り抜きは現在利用できません。時間をおいてお試しください',
  };
  return new ApiError(response.status, messages[response.status] ?? '切り抜きに失敗しました。時間をおいてお試しください');
}

/**
 * 画像を送って生成を頼む。返るのは受付番号だけで、完成はしていない。
 *
 * @param engine どのモデルで作るか。省くとサーバーの既定（hunyuan）
 * @returns jobId。以後この番号で状態を見に行く
 */
export async function createJob(image: Blob, engine?: Engine): Promise<string> {
  const body = new FormData();
  // 拡張子はサーバー側の判定に使われない（中身をデコードして判定している）が、
  // 付けないと一部のブラウザが filename を空にして multipart が崩れる
  body.append('image', image, 'photo.jpg');
  if (engine) body.append('engine', engine);

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

/** 商品ページから取り込んだ結果。詳細は Hunyuan3D-2GP の api/SPEC.md（POST /products） */
export interface ImportedProduct {
  name: string;
  price: number | null;
  shop: string;
  url: string;
  affiliateUrl: string;
  /** 幅・高さ・奥行き（m）。商品名や説明から拾えたときだけ */
  size: { w: number; h: number; d: number } | null;
  /** 商品画像。このあと切り抜きに通す */
  image: Blob;
}

/**
 * 楽天の商品ページの URL から、商品情報と画像を取る。
 *
 * 画像はサーバーが楽天から取って base64 で返す（ブラウザから楽天の CDN は取れない）。
 * ここで Blob に戻して、切り抜きの流れにそのまま渡せる形にする
 */
export async function importProduct(url: string): Promise<ImportedProduct> {
  const response = await fetch(`${API_BASE}/products`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) throw await toProductError(response);
  const body = await response.json();
  return {
    name: body.name,
    price: body.price ?? null,
    shop: body.shop,
    url: body.url,
    affiliateUrl: body.affiliateUrl,
    size: body.size ?? null,
    image: base64ToBlob(body.imageBase64, body.imageType),
  };
}

/** 取り込めなかったときの文言。利用者が次に何をすればよいかで分ける */
async function toProductError(response: Response): Promise<ApiError> {
  const messages: Record<number, string> = {
    400: '楽天市場の商品ページ（item.rakuten.co.jp/…）の URL を貼ってください',
    401: 'Google ログインが必要です',
    404: '商品が見つかりませんでした。販売終了か、URL が正しくない可能性があります',
    429: '今日の取り込み回数の上限に達しました。明日またお試しください',
    502: '楽天市場から商品情報を取得できませんでした。時間をおいてお試しください',
    503: '商品の取り込みは現在利用できません',
  };
  return new ApiError(response.status, messages[response.status] ?? '商品を取り込めませんでした。もう一度お試しください');
}

/** 預けた切り抜きの状態。詳細は Hunyuan3D-2GP の cutout/SPEC.md */
export interface CutoutJobStatus {
  phase: 'queued' | 'running' | 'done' | 'failed';
  /** 推論にかかりそうな秒数。サーバーが直近の実測から出した値 */
  expectedSeconds: number | null;
  /** いまの工程に入ってからの秒数。サーバーの時計で測ったもの */
  elapsed: number;
  error: string | null;
}

/**
 * 写真を預けて受付番号をもらう。切り抜きはあとでできる（getCutoutJob で見に行く）。
 *
 * 1 本の接続で結果を待たないのは、iPhone が PWA を裏に回すと数秒で通信を切るため。
 * 楽天のページに URL をコピーしに行く間に切れていた
 */
export async function createCutoutJob(image: Blob): Promise<{ id: string; expectedSeconds: number | null }> {
  const body = new FormData();
  body.append('image', image, 'photo.jpg');
  const response = await fetch(`${CUTOUT_BASE}/cutout-jobs`, {
    method: 'POST',
    headers: await authHeaders(),
    body,
  });
  if (!response.ok) throw toCutoutError(response);
  const data = (await response.json()) as { id: string; expectedSeconds?: number | null };
  return { id: data.id, expectedSeconds: data.expectedSeconds ?? null };
}

/**
 * 預けた切り抜きの状態。
 *
 * after を渡すと、工程がそこから変わる（か done / failed になる）まで、サーバーで
 * 最大 CUTOUT_WAIT_SECONDS 待ってから返る。2 秒ごとに叩く代わりに、
 * 起動待ち → 推論中 → 完成の変わり目ごとに 1 回で済む
 */
export async function getCutoutJob(
  id: string,
  after: CutoutJobStatus['phase'] | null = null
): Promise<CutoutJobStatus> {
  const query = new URLSearchParams({ wait: String(CUTOUT_WAIT_SECONDS) });
  if (after) query.set('after', after);
  const response = await fetch(`${CUTOUT_BASE}/cutout-jobs/${encodeURIComponent(id)}?${query}`, {
    headers: await authHeaders(),
    // サーバーは wait 秒で必ず返す。それでも返らないのは接続が死んでいるときなので、こちらでも切る
    signal: AbortSignal.timeout((CUTOUT_WAIT_SECONDS + 15) * 1000),
  });
  if (!response.ok) throw toCutoutError(response);
  return (await response.json()) as CutoutJobStatus;
}

/** できあがった切り抜き（透過 PNG）。done になる前は 404 */
export async function getCutoutResult(id: string): Promise<Blob> {
  const response = await fetch(`${CUTOUT_BASE}/cutout-jobs/${encodeURIComponent(id)}/result`, {
    headers: await authHeaders(),
  });
  if (!response.ok) throw toCutoutError(response);
  return response.blob();
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}
