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
    404: 'その商品が見つかりませんでした。販売終了か、URL が違うかもしれません',
    429: '本日の取り込みの上限に達しました。少し待ってからお試しください',
    502: '楽天から商品を取れませんでした。時間をおいて試してください',
    503: '商品の取り込みはまだ使えません',
  };
  return new ApiError(response.status, messages[response.status] ?? '商品を取り込めませんでした');
}

/** サーバーが流してくる工程。詳細は Hunyuan3D-2GP の cutout/SPEC.md */
export type CutoutEvent =
  | { phase: 'received' }
  | { phase: 'cutting'; expectedSeconds: number; elapsed?: number }
  | { phase: 'finishing'; elapsed?: number }
  | { phase: 'done'; png: string }
  | { phase: 'failed'; error: string };

/** 応答をどこまで読めたか。done が来ずに終わったとき、原因を絞る手がかりとして文言に添える */
interface ReadStats {
  chunks: number;
  bytes: number;
}

/**
 * 写真を送って、家具だけを切り抜いた透過 PNG を受け取る。数秒で返る。
 *
 * 応答は工程を 1 行ずつ流す NDJSON。届いた行ごとに onEvent を呼び、最後の行の PNG を返す。
 * 1 行目が届くまでの空白がコールドスタート（サーバーの起動待ち）で、その間も
 * 呼び出し側は「起動を待っている」と出せる。
 *
 * 待つ上限を置く。サーバー側にも 60 秒の打ち切りがあるが、通信が途中で
 * 切れたときは応答そのものが来ないので、こちらでも切る。
 *
 * 同じ工程の行が 2 秒ごとに繰り返し届く（接続を黙らせないため）。onEvent は
 * その繰り返しごとに呼ぶので、呼び出し側は工程が変わったかを見て扱う
 */
export async function createCutout(
  image: Blob,
  onEvent: (event: CutoutEvent) => void
): Promise<Blob> {
  const body = new FormData();
  body.append('image', image, 'photo.jpg');

  const response = await fetch(`${CUTOUT_BASE}/cutouts`, {
    method: 'POST',
    headers: { ...(await authHeaders()), Accept: 'application/x-ndjson' },
    body,
    signal: AbortSignal.timeout(CUTOUT_TIMEOUT_MS),
  });
  if (!response.ok) throw toCutoutError(response);

  const startedAt = Date.now();
  const stats: ReadStats = { chunks: 0, bytes: 0 };
  let lastPhase: string | null = null;
  let result: Blob | null = null;
  for await (const line of readLines(response, stats)) {
    const event = JSON.parse(line) as CutoutEvent;
    if (event.phase === 'failed') throw new ApiError(500, event.error);
    if (event.phase === 'done') {
      result = base64ToBlob(event.png, 'image/png');
      break;
    }
    lastPhase = event.phase;
    onEvent(event);
  }
  if (!result) {
    // 応答が途中で（行の切れ目で）終わった。どこまで届いたかを添えて、再発時に原因を絞れるようにする
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const detail = `${lastPhase ?? '工程の行なし'} まで受信・${stats.chunks} 回 ${Math.round(stats.bytes / 1024)}KB・${seconds} 秒`;
    throw new ApiError(500, `切り抜きの結果が届きませんでした（${detail}）`);
  }
  return result;
}

/**
 * 応答の本文を、届いた順に 1 行ずつ返す。
 *
 * 本文を最後まで待ってから分けると、工程を流してもらう意味が無い。
 * 読み進めながら改行で区切る。ストリームを読めない古いブラウザでは全文を待って分ける
 */
async function* readLines(response: Response, stats: ReadStats): AsyncGenerator<string> {
  if (!response.body) {
    const text = await response.text();
    stats.chunks = 1;
    stats.bytes = text.length;
    for (const line of text.split('\n')) if (line) yield line;
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      stats.chunks += 1;
      stats.bytes += value.byteLength;
    }
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split('\n');
    // 最後の要素は途中の行（まだ改行が来ていない）なので次に回す
    buffered = lines.pop() ?? '';
    for (const line of lines) if (line) yield line;
    if (done) break;
  }
  if (buffered) yield buffered;
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}
