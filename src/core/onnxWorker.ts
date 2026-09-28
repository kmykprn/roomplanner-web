/**
 * ONNX のモデルを動かすワーカー（core/onnxModel.ts から使う）。
 *
 * **推論を画面とは別のスレッドで動かすためのもの。** 画面と同じスレッドで動かすと、
 * 推論の数秒〜数十秒の間は画面が固まり、経過秒数も進まなくなる。
 * モデルを落とすのもここで行う（初めて推論するとき。2 回目からは同じものを使う）。
 *
 * やりとり（画面 → ワーカー）:
 *   run … モデルで推論する。入力と出力は数値の配列と形
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

/** モデルを読む。2 回目からは落とさずに同じものを使う */
function load(url: string): Promise<ort.InferenceSession> {
  let session = sessions.get(url);
  if (!session) {
    session = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`モデルを読めませんでした（${response.status}）`);
        return response.arrayBuffer();
      })
      .then((bytes) => ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] }))
      .catch((error) => {
        sessions.delete(url); // 落とせなかったら次回また試す
        throw error;
      });
    sessions.set(url, session);
  }
  return session;
}

async function run(url: string, feeds: Record<string, TensorData>): Promise<Record<string, TensorData>> {
  const session = await load(url);
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
  run(request.url, request.feeds)
    .then((outputs) =>
      reply({ id: request.id, type: 'done', outputs }, Object.values(outputs).map((tensor) => tensor.data.buffer))
    )
    .catch((error: unknown) =>
      reply({ id: request.id, type: 'error', message: error instanceof Error ? error.message : String(error) })
    );
});
