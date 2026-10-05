/**
 * ONNX のモデルを端末の中で動かすための共通部分（写真の傾きと画角、写真の奥行き）。
 *
 * **推論はワーカー（core/onnxWorker.ts）で動かす。** 画面と同じスレッドで動かすと、
 * 推論の間は画面が固まり、経過秒数も進まなくなる。
 *
 * モデルは数十 MB あり、初めて推論するときにワーカーが落とす。2 回目からは Service Worker の
 * キャッシュから読むので、すぐ終わる。
 */

/** ワーカーとやりとりする数値の配列と形 */
export interface TensorData {
  data: Float32Array;
  dims: number[];
}

/** 頼みごとの中身。モデルがまだ読まれていなければ、ワーカーが先に読む */
type RequestBody = { type: 'run'; url: string; feeds: Record<string, TensorData> };

/** 画面 → ワーカー。返事と結び付けるための番号を付けて送る */
export type WorkerRequest = RequestBody & { id: number };

/** ワーカーがいま何をしているか。メモリの記録に添える */
export type HeapStage = 'idle' | 'loading' | 'running';

/** ワーカーの wasm のメモリの大きさ。伸びるたびに知らせが来る */
export interface HeapInfo {
  megabytes: number;
  stage: HeapStage;
}

/** ワーカー → 画面。heap は頼みごとに紐づかない知らせ */
export type WorkerReply =
  | { id: number; type: 'done'; outputs: Record<string, TensorData> }
  | { id: number; type: 'error'; message: string }
  | { type: 'heap'; bytes: number; stage: HeapStage };

/** 返事を待っている頼みごと */
interface Pending {
  resolve(outputs: Record<string, TensorData>): void;
  reject(error: Error): void;
}

let worker: Worker | null = null;
const pending = new Map<number, Pending>();
let nextId = 0;

/**
 * メモリの伸びを聞きたい側（core/cutout.ts）。iPhone はメモリ不足だと例外を出さずにページごと止めるので、
 * 落ちる直前の大きさを端末に残すのに使う
 */
const heapListeners = new Set<(info: HeapInfo) => void>();
let lastHeap: HeapInfo | null = null;

export function onHeapGrowth(listener: (info: HeapInfo) => void): () => void {
  heapListeners.add(listener);
  return () => heapListeners.delete(listener);
}

/** 最後に知らされたワーカーのメモリの大きさ。まだ何も動かしていなければ null */
export function lastHeapInfo(): HeapInfo | null {
  return lastHeap;
}

/** ワーカーは最初に頼むときに作る。起動時の読み込みに混ぜない */
function workerOf(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./onnxWorker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
      const message = event.data;
      if (message.type === 'heap') {
        lastHeap = { megabytes: Math.round(message.bytes / 1048576), stage: message.stage };
        for (const listener of heapListeners) listener(lastHeap);
        return;
      }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.type === 'done') request.resolve(message.outputs);
      else request.reject(new Error(message.message));
    });
  }
  return worker;
}

/** ワーカーに頼んで、返事を待つ */
function ask(request: RequestBody, transfer: Transferable[] = []): Promise<Record<string, TensorData>> {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const message: WorkerRequest = { ...request, id };
    workerOf().postMessage(message, transfer);
  });
}

/** モデルの URL（public/models/ の下のファイル名から作る）。ワーカーからも読めるよう、ページを基準に絶対の URL にする */
function modelUrl(fileName: string): string {
  return new URL(`${import.meta.env.BASE_URL}models/${fileName}`, document.baseURI).href;
}

/** モデルで推論する。まだ読んでいなければ先に読む。入力の配列はワーカーに渡すので、呼んだあとは使えない */
export async function runModel(fileName: string, feeds: Record<string, TensorData>): Promise<Record<string, TensorData>> {
  const transfer = Object.values(feeds).map((tensor) => tensor.data.buffer);
  return ask({ type: 'run', url: modelUrl(fileName), feeds }, transfer);
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
