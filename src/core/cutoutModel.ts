/**
 * 写真から家具を切り抜く（BiRefNet-lite を端末の中で動かす）。
 *
 * 流れ:
 *   1. 写真を 512×512 に引き伸ばし、ImageNet の平均と分散で正規化してネットワークに渡す（サーバーの切り抜きと同じ前処理）
 *   2. 出た値を sigmoid で 0〜1 にし、最小と最大で引き伸ばす（引き伸ばさないと背景がうっすら残る。サーバーと同じ）
 *   3. 写真の大きさに戻して不透明度にし、中身のまわりに 2% の余白を残して切り詰め、PNG にする
 *
 * **写真は端末の外に出ない。** モデル（約 52MB）は初回だけ落とす（core/onnxModel.ts）。
 * サーバーは 1024×1024 で動かすが、ブラウザではメモリが足りない（1024 で 3.6GB、768 で 1.9GB）ので 512 にした。
 * 512 でも輪郭は 1024 とほぼ同じ（重なり 0.90）。384 や 448 では家具が検出されないことがあるので、これ以上は小さくしない。
 * 512 の最大メモリは 0.78GB（PC のブラウザ）。深度の AI と同じく、重みだけ int8 にしてある
 * （作り方は assets-src/models/birefnet/README.md）。
 *
 * メモリ不足・モデルを読めない・時間切れのときは例外になる。呼ぶ側（core/cutout.ts）がサーバーに切り替える
 */

import { decodePhoto, runModel, type TensorData } from '@/core/onnxModel';

const MODEL_FILE = 'birefnet-lite-512-int8w.onnx';
/** モデルの入力の大きさ。書き出したときに固定している */
const INPUT_SIZE = 512;
/** ImageNet の平均と分散。学習時と同じ値でないと精度が落ちる */
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
/** 切り詰めるときの余白（辺に対する比）と、「中身がある」とみなす不透明度。サーバーと同じ */
const CROP_MARGIN = 0.02;
const CROP_ALPHA_THRESHOLD = 8;
/** これ以上かかったら諦めてサーバーに頼む（端末によっては 10 秒ほどかかる。十分に余裕を見る） */
const TIMEOUT_MS = 90_000;

/** 写真（JPEG や PNG の Blob）を切り抜き、透過 PNG を返す */
export async function cutoutOnDevice(photo: Blob): Promise<Blob> {
  const url = URL.createObjectURL(photo);
  try {
    const image = await decodePhoto(url);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    // 写真をキャンバスに描いて画素を取る。ネットワークの入力にも、あとで不透明度を付けるのにも使う
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    const feeds: Record<string, TensorData> = { input_image: { data: toNetworkInput(pixels, width, height), dims: [1, 3, INPUT_SIZE, INPUT_SIZE] } };
    const outputs = await withTimeout(runModel(MODEL_FILE, feeds), TIMEOUT_MS);
    const logits = Object.values(outputs)[0].data;
    const alpha = toAlpha(logits);
    return await toCroppedPng(canvas, alpha);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 写真を 512×512 に縮めて、ネットワークの入力（NCHW、正規化済み）にする。
 *
 * **縮めるのはブラウザに任せず、自前で画素を平均する。** drawImage の縮め方はブラウザごとに違い、
 * 結果がブラウザによって変わる。出力の 1 画素に当たる元の範囲の画素を平均する（Pillow の BOX と同じ）ので、
 * どのブラウザでも Python で動かしたときと同じ入力になる（tests/cutoutOnDevice.spec.ts で重なり 0.98）
 */
function toNetworkInput(pixels: Uint8ClampedArray, width: number, height: number): Float32Array {
  const plane = INPUT_SIZE * INPUT_SIZE;
  const data = new Float32Array(3 * plane);
  for (let oy = 0; oy < INPUT_SIZE; oy += 1) {
    const y0 = Math.floor((oy * height) / INPUT_SIZE);
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * height) / INPUT_SIZE));
    for (let ox = 0; ox < INPUT_SIZE; ox += 1) {
      const x0 = Math.floor((ox * width) / INPUT_SIZE);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * width) / INPUT_SIZE));
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * width + x) * 4;
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      const o = oy * INPUT_SIZE + ox;
      data[o] = (r / count / 255 - MEAN[0]) / STD[0];
      data[plane + o] = (g / count / 255 - MEAN[1]) / STD[1];
      data[2 * plane + o] = (b / count / 255 - MEAN[2]) / STD[2];
    }
  }
  return data;
}

/** ネットワークの出力（512×512 のロジット）を、0〜255 の不透明度にする */
function toAlpha(logits: Float32Array): Uint8ClampedArray {
  const values = new Float32Array(logits.length);
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < logits.length; i += 1) {
    const value = 1 / (1 + Math.exp(-logits[i]));
    values[i] = value;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const scale = high > low ? 1 / (high - low) : 1;
  const alpha = new Uint8ClampedArray(logits.length);
  for (let i = 0; i < logits.length; i += 1) alpha[i] = Math.round((values[i] - low) * scale * 255);
  return alpha;
}

/** 写真（描いてあるキャンバス）に不透明度を付け、中身のまわりで切り詰めて PNG にする */
async function toCroppedPng(canvas: HTMLCanvasElement, alpha: Uint8ClampedArray): Promise<Blob> {
  const { width, height } = canvas;
  // 不透明度を 512×512 の画像にする（色は使わない。drawImage で写真の大きさに戻す）
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = INPUT_SIZE;
  maskCanvas.height = INPUT_SIZE;
  const maskContext = maskCanvas.getContext('2d')!;
  const maskPixels = maskContext.createImageData(INPUT_SIZE, INPUT_SIZE);
  for (let i = 0; i < alpha.length; i += 1) maskPixels.data[i * 4 + 3] = alpha[i];
  maskContext.putImageData(maskPixels, 0, 0);

  const context = canvas.getContext('2d')!;
  context.imageSmoothingQuality = 'high';
  // 写真の各画素に、マスクの不透明度を掛ける
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(maskCanvas, 0, 0, width, height);
  context.globalCompositeOperation = 'source-over';

  const box = contentBox(context.getImageData(0, 0, width, height).data, width, height);
  const cropped = document.createElement('canvas');
  cropped.width = box.right - box.left;
  cropped.height = box.bottom - box.top;
  cropped.getContext('2d')!.drawImage(canvas, box.left, box.top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
  return new Promise((resolve, reject) => {
    cropped.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('切り抜きを画像にできませんでした'))), 'image/png');
  });
}

/** 中身のある範囲に、少しだけ余白を足したもの。何も無ければ全体 */
function contentBox(pixels: Uint8ClampedArray, width: number, height: number): { left: number; top: number; right: number; bottom: number } {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] < CROP_ALPHA_THRESHOLD) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return { left: 0, top: 0, right: width, bottom: height };
  right += 1;
  bottom += 1;
  const marginX = Math.floor((right - left) * CROP_MARGIN);
  const marginY = Math.floor((bottom - top) * CROP_MARGIN);
  return {
    left: Math.max(0, left - marginX),
    top: Math.max(0, top - marginY),
    right: Math.min(width, right + marginX),
    bottom: Math.min(height, bottom + marginY),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('端末での切り抜きに時間がかかりすぎました')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
