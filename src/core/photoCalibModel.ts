/**
 * 写真を解析して、カメラの画角と傾きを出す（GeoCalib のネットワーク部分をブラウザで動かす）。
 *
 * 流れ:
 *   1. 写真を短辺 320px に縮め、縦横を 32 の倍数に切り詰める（GeoCalib の前処理と同じ）
 *   2. ONNX にしたネットワークで「上向きの場」「緯度の場」を出す（端末の中で数秒）
 *   3. その場からカメラを解く（core/photoCalib.ts）
 *
 * **写真は端末の外に出ない。** モデル（約 31MB）は初回だけ落として、以後はキャッシュから読む。
 * ネットワークの入力は RGB を 0〜1 にしただけで、平均や標準偏差の正規化は無い。
 */

// wasm 専用の入口。既定の入口は WebGPU 込みの別の wasm を探しに行く
import * as ort from 'onnxruntime-web/wasm';
// wasm 本体と、それを読む小さなモジュール。public に置くと Vite が module として読ませて
// くれないので、バンドルの資産として持たせる（ビルドでは assets/ に入り、Service Worker が残す）
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import wasmLoaderUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';

import { calibrateFromFields, type CalibFields } from '@/core/photoCalib';

/** 縮小後の短辺（GeoCalib の既定値） */
const SHORT_EDGE = 320;
/** 縦横をこの倍数に切り詰める（ネットワークの都合） */
const EDGE_MULTIPLE = 32;

const MODEL_URL = `${import.meta.env.BASE_URL}models/geocalib-int8.onnx`;

export interface PhotoCalibration {
  /** 縦の画角（度）。元の写真の全高に対する値 */
  vfovDeg: number;
  /** 見下ろし角（度）。正で見下ろし */
  pitchDeg: number;
  /** ロール（度）。GeoCalib の向きのまま */
  rollDeg: number;
  /** 最適化の残り誤差。写真が場で説明できていないほど大きい */
  cost: number;
}

let session: Promise<ort.InferenceSession> | null = null;

/** モデルを読む。2 回目からは同じものを使い回す */
function loadSession(): Promise<ort.InferenceSession> {
  if (!session) {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmLoaderUrl };
    session = ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] }).catch((error) => {
      session = null; // 落とせなかったら次回また試す
      throw error;
    });
  }
  return session;
}

/** 写真を読み込んで、ネットワークの入力（NCHW, 0〜1）にする */
async function preprocess(url: string): Promise<{ data: Float32Array; width: number; height: number; scale: number; fullHeight: number }> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const fullWidth = image.naturalWidth;
  const fullHeight = image.naturalHeight;

  const scale = SHORT_EDGE / Math.min(fullWidth, fullHeight);
  const resizedWidth = Math.round(fullWidth * scale);
  const resizedHeight = Math.round(fullHeight * scale);
  const width = Math.floor(resizedWidth / EDGE_MULTIPLE) * EDGE_MULTIPLE;
  const height = Math.floor(resizedHeight / EDGE_MULTIPLE) * EDGE_MULTIPLE;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas が使えません');
  // 縮めてから、中央を切り詰める（GeoCalib は端を落とす。数画素の差なので中央で揃える）
  context.drawImage(
    image,
    0, 0, fullWidth, fullHeight,
    -(resizedWidth - width) / 2, -(resizedHeight - height) / 2, resizedWidth, resizedHeight
  );
  const pixels = context.getImageData(0, 0, width, height).data;

  const plane = width * height;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    data[i] = pixels[i * 4] / 255;
    data[plane + i] = pixels[i * 4 + 1] / 255;
    data[2 * plane + i] = pixels[i * 4 + 2] / 255;
  }
  return { data, width, height, scale, fullHeight };
}

/** 写真の URL を渡すと、画角と傾きを返す。数秒かかるので待たせる側は進み具合を出すこと */
export async function calibratePhoto(url: string): Promise<PhotoCalibration> {
  const [model, input] = await Promise.all([loadSession(), preprocess(url)]);
  const feeds = { image: new ort.Tensor('float32', input.data, [1, 3, input.height, input.width]) };
  const output = await model.run(feeds);

  const fields: CalibFields = {
    width: input.width,
    height: input.height,
    up: output.up_field.data as Float32Array,
    upConfidence: output.up_confidence.data as Float32Array,
    latitude: output.latitude_field.data as Float32Array,
    latitudeConfidence: output.latitude_confidence.data as Float32Array,
  };
  const result = calibrateFromFields(fields);

  // 焦点距離を元の写真の画素数に戻し、切り詰める前の全高で画角を出す
  const focalFull = result.focalPx / input.scale;
  return {
    vfovDeg: (2 * Math.atan(input.fullHeight / (2 * focalFull)) * 180) / Math.PI,
    pitchDeg: result.pitchDeg,
    rollDeg: result.rollDeg,
    cost: result.cost,
  };
}
