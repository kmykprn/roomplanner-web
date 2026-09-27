/**
 * ONNX のモデルを端末の中で動かすための共通部分（写真の傾きと画角、写真の奥行き）。
 *
 * **推論はワーカー（core/onnxWorker.ts）で動かす。** 画面と同じスレッドで動かすと、
 * 推論の間は画面が固まり、経過秒数も進まなくなる。
 *
 * モデルは数十 MB あるので、**落とした量を数えながら読む。** 初回は数十秒かかることがあり、
 * 進み具合を出さないと止まっているのか分からない。2 回目からは Service Worker の
 * キャッシュから読むので、すぐ終わる。
 */

/** 落とした量。total は分からなければ null（サーバーが大きさを返さないとき） */
export interface DownloadProgress {
  loaded: number;
  total: number | null;
}

/** ワーカーとやりとりする数値の配列と形 */
export interface TensorData {
  data: Float32Array;
  dims: number[];
}

/** 頼みごとの中身 */
type RequestBody =
  | { type: 'load'; url: string }
  | { type: 'run'; url: string; feeds: Record<string, TensorData> };

/** 画面 → ワーカー。返事と結び付けるための番号を付けて送る */
export type WorkerRequest = RequestBody & { id: number };

/** ワーカー → 画面 */
export type WorkerReply =
  | { id: number; type: 'progress'; loaded: number; total: number | null }
  | { id: number; type: 'done'; outputs: Record<string, TensorData> | null }
  | { id: number; type: 'error'; message: string };

/** 返事を待っている頼みごと */
interface Pending {
  resolve(outputs: Record<string, TensorData> | null): void;
  reject(error: Error): void;
  onProgress?(progress: DownloadProgress): void;
}

let worker: Worker | null = null;
const pending = new Map<number, Pending>();
let nextId = 0;

/** ワーカーは最初に頼むときに作る。起動時の読み込みに混ぜない */
function workerOf(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./onnxWorker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
      const message = event.data;
      const request = pending.get(message.id);
      if (!request) return;
      if (message.type === 'progress') {
        request.onProgress?.({ loaded: message.loaded, total: message.total });
        return;
      }
      pending.delete(message.id);
      if (message.type === 'done') request.resolve(message.outputs);
      else request.reject(new Error(message.message));
    });
  }
  return worker;
}

/** ワーカーに頼んで、返事を待つ */
function ask(
  request: RequestBody,
  onProgress?: (progress: DownloadProgress) => void,
  transfer: Transferable[] = []
): Promise<Record<string, TensorData> | null> {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    const message: WorkerRequest = { ...request, id };
    workerOf().postMessage(message, transfer);
  });
}

/** モデルの URL（public/models/ の下のファイル名から作る）。ワーカーからも読めるよう、ページを基準に絶対の URL にする */
function modelUrl(fileName: string): string {
  return new URL(`${import.meta.env.BASE_URL}models/${fileName}`, document.baseURI).href;
}

/**
 * モデルを落として、動かせる状態にする。落とすのは初回だけ。
 * 2 回目からは落とさずに済む（進み具合は呼ばれない）
 */
export async function loadModel(
  fileName: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  await ask({ type: 'load', url: modelUrl(fileName) }, onProgress);
}

/** モデルで推論する。まだ読んでいなければ先に読む。入力の配列はワーカーに渡すので、呼んだあとは使えない */
export async function runModel(fileName: string, feeds: Record<string, TensorData>): Promise<Record<string, TensorData>> {
  const transfer = Object.values(feeds).map((tensor) => tensor.data.buffer);
  const outputs = await ask({ type: 'run', url: modelUrl(fileName), feeds }, undefined, transfer);
  if (!outputs) throw new Error('推論の結果がありませんでした');
  return outputs;
}

/** 写真を読み込んで、描ける画像にする */
export async function decodePhoto(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

/** キャンバスの画素を、ネットワークの入力（NCHW, RGB を 0〜1）にする */
export function toInputPlanes(pixels: Uint8ClampedArray, width: number, height: number): Float32Array {
  const plane = width * height;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    data[i] = pixels[i * 4] / 255;
    data[plane + i] = pixels[i * 4 + 1] / 255;
    data[2 * plane + i] = pixels[i * 4 + 2] / 255;
  }
  return data;
}
