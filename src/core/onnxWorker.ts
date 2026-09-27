/**
 * ONNX のモデルを動かすワーカー（core/onnxModel.ts から使う）。
 *
 * **推論を画面とは別のスレッドで動かすためのもの。** 画面と同じスレッドで動かすと、
 * 推論の数秒〜数十秒の間は画面が固まり、経過秒数も進まなくなる。
 * モデルを落とすのもここで行い、落とした量は進み具合として画面に送る。
 *
 * やりとり（画面 → ワーカー）:
 *   load … モデルを落として動かせる状態にする。落とした量を progress で返す
 *   run  … 読んだモデルで推論する。入力と出力は数値の配列と形
 */

/// <reference lib="webworker" />

// wasm 専用の入口。既定の入口は WebGPU 込みの別の wasm を探しに行く
import * as ort from 'onnxruntime-web/wasm';
// wasm 本体と、それを読む小さなモジュール。バンドルの資産として持たせる
// （ビルドでは assets/ に入り、Service Worker が残す）
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import wasmLoaderUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';

import type { TensorData, WorkerReply, WorkerRequest } from '@/core/onnxModel';

declare const self: DedicatedWorkerGlobalScope;

ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmLoaderUrl };

/** 読み終えたモデル。キーはモデルの URL */
const sessions = new Map<string, Promise<ort.InferenceSession>>();

function reply(message: WorkerReply, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

/** 落とした量を数えながら、ファイルを丸ごと読む */
async function download(id: number, url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`モデルを読めませんでした（${response.status}）`);
  const header = Number(response.headers.get('Content-Length'));
  const total = Number.isFinite(header) && header > 0 ? header : null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  reply({ id, type: 'progress', loaded, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    reply({ id, type: 'progress', loaded, total });
  }

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** モデルを読む。2 回目からは落とさずに同じものを使う */
function load(id: number, url: string): Promise<ort.InferenceSession> {
  let session = sessions.get(url);
  if (!session) {
    session = download(id, url)
      .then((bytes) => ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }))
      .catch((error) => {
        sessions.delete(url); // 落とせなかったら次回また試す
        throw error;
      });
    sessions.set(url, session);
  }
  return session;
}

async function run(url: string, feeds: Record<string, TensorData>): Promise<Record<string, TensorData>> {
  const session = await load(-1, url);
  const inputs: Record<string, ort.Tensor> = {};
  for (const [name, tensor] of Object.entries(feeds)) inputs[name] = new ort.Tensor('float32', tensor.data, tensor.dims);
  const outputs = await session.run(inputs);
  const result: Record<string, TensorData> = {};
  for (const [name, tensor] of Object.entries(outputs)) {
    result[name] = { data: tensor.data as Float32Array, dims: [...tensor.dims] };
  }
  return result;
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const work =
    request.type === 'load'
      ? load(request.id, request.url).then(() => reply({ id: request.id, type: 'done', outputs: null }))
      : run(request.url, request.feeds).then((outputs) =>
          reply(
            { id: request.id, type: 'done', outputs },
            Object.values(outputs).map((tensor) => tensor.data.buffer)
          )
        );
  work.catch((error: unknown) =>
    reply({ id: request.id, type: 'error', message: error instanceof Error ? error.message : String(error) })
  );
});
