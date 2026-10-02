/**
 * 写真の奥行き（カメラから各点までの距離）を出す（MoGe-2 ViT-S のネットワーク部分をブラウザで動かす）。
 *
 * 流れ:
 *   1. 写真を 560×420 に縮める。縦長の写真は 90° 回して横長にしてから縮める
 *      （モデルはこの大きさ専用。16:9 などは引き伸ばして入れる。精度はほぼ落ちないことを確かめた）
 *   2. ネットワークで「点の地図」「写っている所」「実寸への倍率」を出す（runDepthNetwork。端末の中で数秒〜数十秒）
 *   3. 画角が分かっていなければ、点の地図から画角を推定する（estimateVfov。本家 MoGeModel.infer で fov_x を渡さないときと同じ）
 *   4. 画角を決めて、点の地図の奥行きのずれを最小二乗で直し、倍率を掛けて m にする
 *      （depthFromOutput。本家 MoGeModel.infer(fov_x=…) と同じ後処理）
 *
 * 画角は、傾きの AI（GeoCalib）より、この AI に推定させたほうが合う。CG の部屋の画像 30 枚で、
 * 正しい画角とのずれ（中央値）が 6.7° から 3.0° に減った。奥行きと画角のつじつまも合う
 *
 * **写真は端末の外に出ない。** モデル（約 44MB）は初回だけ落とす（core/onnxModel.ts）。
 * モデルは重みだけを int8 で持ち、計算は fp32 のまま。ふつうの int8 化はブラウザでは 5 倍遅くなった。
 */

import { decodePhoto, runModel, toInputPlanes, type TensorData } from '@/core/onnxModel';

const MODEL_FILE = 'moge2-vits-int8w.onnx';
/** モデルの入力の大きさ（横長の向き）。書き出したときに固定している */
const INPUT_WIDTH = 560;
const INPUT_HEIGHT = 420;
/** 奥行きのずれを解くときに間引く目の数（本家と同じ 64×64） */
const SHIFT_GRID = 64;

/**
 * 写真の奥行きの地図。写真と同じ向きで、左上から横に並ぶ。
 * 値はカメラの正面方向の距離（m）。写っていない所（空など）は NaN
 */
export interface DepthMap {
  width: number;
  height: number;
  data: Float32Array;
}

/**
 * 写真を横長の入力にする。縦長なら時計回りに 90° 回す。
 * 回した写真の点 (x, y) は、元の写真の (y, 元の高さ − 1 − x) に当たる
 */
function preprocess(image: HTMLImageElement, rotate: boolean): Float32Array {
  const canvas = document.createElement('canvas');
  canvas.width = INPUT_WIDTH;
  canvas.height = INPUT_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas が使えません');
  // なめらかに縮める（精度を確かめたときと同じ縮め方に近づける）。縮め方が違うと奥行き全体の
  // 倍率が数 % 変わるが、線の長さで倍率を合わせ直すので、寸法の結果には効かない
  context.imageSmoothingQuality = 'high';
  if (rotate) {
    context.translate(INPUT_WIDTH, 0);
    context.rotate(Math.PI / 2);
    context.drawImage(image, 0, 0, INPUT_HEIGHT, INPUT_WIDTH);
  } else {
    context.drawImage(image, 0, 0, INPUT_WIDTH, INPUT_HEIGHT);
  }
  return toInputPlanes(context.getImageData(0, 0, INPUT_WIDTH, INPUT_HEIGHT).data, INPUT_WIDTH, INPUT_HEIGHT);
}

/**
 * 奥行きのずれ shift を解く。
 *
 * ネットワークの点の地図は、奥行きがずれた形（z + shift が本当の奥行き）で出てくる。
 * 焦点距離が分かっていれば、各点を写真に写し直した位置が、その点の写真の位置と合うように
 * shift を 1 つだけ決められる: min Σ |focal · (x, y) / (z + shift) − (u, v)|²
 * 本家は scipy の LM 法で解いている。未知数が 1 つなので、ここでは減衰付きのガウス・ニュートン法で解く
 */
function solveShift(x: number[], y: number[], z: number[], u: number[], v: number[], focal: number): number {
  let shift = 0;
  let damping = 1e-3;
  const costAt = (s: number): number => {
    let cost = 0;
    for (let i = 0; i < z.length; i += 1) {
      const depth = z[i] + s;
      cost += (focal * x[i] / depth - u[i]) ** 2 + (focal * y[i] / depth - v[i]) ** 2;
    }
    return cost;
  };
  let cost = costAt(shift);
  for (let iteration = 0; iteration < 50; iteration += 1) {
    let gradient = 0;
    let hessian = 0;
    for (let i = 0; i < z.length; i += 1) {
      const depth = z[i] + shift;
      const rx = focal * x[i] / depth - u[i];
      const ry = focal * y[i] / depth - v[i];
      // 残差を shift で微分したもの
      const jx = -focal * x[i] / (depth * depth);
      const jy = -focal * y[i] / (depth * depth);
      gradient += jx * rx + jy * ry;
      hessian += jx * jx + jy * jy;
    }
    const step = -gradient / (hessian * (1 + damping) + 1e-12);
    const nextCost = costAt(shift + step);
    if (Number.isFinite(nextCost) && nextCost < cost) {
      shift += step;
      damping /= 10;
      const improved = cost - nextCost;
      cost = nextCost;
      if (improved < 1e-6 * cost) break;
    } else {
      damping *= 10;
      if (damping > 1e8) break;
    }
  }
  return shift;
}

/** ネットワークの出力と、元の写真の大きさ。画角を決めてから奥行きの地図にする（depthFromOutput） */
export interface DepthNetworkResult {
  output: Record<string, TensorData>;
  photoWidth: number;
  photoHeight: number;
}

/** 写真の URL から、ネットワークの出力を出す。数秒〜数十秒かかる */
export async function runDepthNetwork(url: string): Promise<DepthNetworkResult> {
  const image = await decodePhoto(url);
  const photoWidth = image.naturalWidth;
  const photoHeight = image.naturalHeight;
  const input = preprocess(image, photoHeight > photoWidth);
  const output = await runModel(MODEL_FILE, { image: { data: input, dims: [1, 3, INPUT_HEIGHT, INPUT_WIDTH] } });
  return { output, photoWidth, photoHeight };
}

/** 入力の縦横比と、写真の面の上の位置の広がり（対角の半分を 1 とする）。本家の normalized_view_plane_uv と同じ */
const INPUT_ASPECT = INPUT_WIDTH / INPUT_HEIGHT;
const SPAN_X = INPUT_ASPECT / Math.sqrt(1 + INPUT_ASPECT * INPUT_ASPECT);
const SPAN_Y = 1 / Math.sqrt(1 + INPUT_ASPECT * INPUT_ASPECT);

/** 64×64 に最近傍で間引いた、写っている所の点と、その写真の面の上の位置 */
function gridSamples(output: Record<string, TensorData>): { x: number[]; y: number[]; z: number[]; u: number[]; v: number[] } {
  const points = output.points.data;
  const mask = output.mask.data;
  const x: number[] = [];
  const y: number[] = [];
  const z: number[] = [];
  const u: number[] = [];
  const v: number[] = [];
  for (let gy = 0; gy < SHIFT_GRID; gy += 1) {
    const row = Math.floor((gy * INPUT_HEIGHT) / SHIFT_GRID);
    for (let gx = 0; gx < SHIFT_GRID; gx += 1) {
      const column = Math.floor((gx * INPUT_WIDTH) / SHIFT_GRID);
      const index = row * INPUT_WIDTH + column;
      if (mask[index] <= 0.5) continue;
      x.push(points[index * 3]);
      y.push(points[index * 3 + 1]);
      z.push(points[index * 3 + 2]);
      u.push(SPAN_X * ((2 * column + 1) / INPUT_WIDTH - 1));
      v.push(SPAN_Y * ((2 * row + 1) / INPUT_HEIGHT - 1));
    }
  }
  return { x, y, z, u, v };
}

/** 回したあとの（モデルに入れた）写真の縦横比。縦長を回したなら、元の縦が横になる */
function modelAspect(photoWidth: number, photoHeight: number): number {
  return photoHeight > photoWidth ? photoHeight / photoWidth : photoWidth / photoHeight;
}

/**
 * 点の地図から、元の写真の縦の画角（度）を推定する。
 *
 * 点を写真に写し直した位置が、その点の写真の位置と合うように、焦点距離と奥行きのずれ shift を一緒に決める:
 * min Σ |focal · (x, y) / (z + shift) − (u, v)|²。shift を決めれば焦点距離は 1 回の計算で決まるので、
 * shift だけを 1 次元で探す（粗く並べて当たりを付け、黄金分割で詰める）
 */
export function estimateVfov({ output, photoWidth, photoHeight }: DepthNetworkResult): number {
  const { x, y, z, u, v } = gridSamples(output);
  if (z.length < 2) throw new Error('写真の奥行きを出せませんでした');
  const bestFocal = (shift: number): { focal: number; cost: number } => {
    let num = 0;
    let den = 0;
    for (let i = 0; i < z.length; i += 1) {
      const ax = x[i] / (z[i] + shift);
      const ay = y[i] / (z[i] + shift);
      num += ax * u[i] + ay * v[i];
      den += ax * ax + ay * ay;
    }
    const focal = num / den;
    let cost = 0;
    for (let i = 0; i < z.length; i += 1) {
      const d = z[i] + shift;
      cost += (focal * x[i] / d - u[i]) ** 2 + (focal * y[i] / d - v[i]) ** 2;
    }
    return { focal, cost };
  };
  // shift は「どの点の奥行きも正」になる範囲（z + shift > 0）で探す
  const lowest = -Math.min(...z) + 1e-3;
  const STEPS = 400;
  let bestIndex = 0;
  let bestCost = Infinity;
  const at = (i: number): number => lowest + 1e-3 * (50 / 1e-3) ** (i / (STEPS - 1));
  for (let i = 0; i < STEPS; i += 1) {
    const { cost } = bestFocal(at(i));
    if (cost < bestCost) {
      bestCost = cost;
      bestIndex = i;
    }
  }
  let a = at(Math.max(0, bestIndex - 1));
  let b = at(Math.min(STEPS - 1, bestIndex + 1));
  for (let k = 0; k < 60; k += 1) {
    const m1 = a + (b - a) * 0.382;
    const m2 = a + (b - a) * 0.618;
    if (bestFocal(m1).cost < bestFocal(m2).cost) b = m2;
    else a = m1;
  }
  const { focal } = bestFocal((a + b) / 2);
  // 焦点距離（対角の半分を 1 とした長さ）→ モデルの横の画角 → 元の写真の縦の画角（depthFromOutput の逆）
  const aspect = modelAspect(photoWidth, photoHeight);
  const halfHorizontal = aspect / Math.sqrt(1 + aspect * aspect) / focal;
  const halfVertical = photoHeight > photoWidth ? halfHorizontal : halfHorizontal / aspect;
  return (2 * Math.atan(halfVertical) * 180) / Math.PI;
}

/**
 * ネットワークの出力から奥行きの地図を作る（後処理）。
 * photoWidth・photoHeight は元の写真の大きさ（縦長なら回して入れた前提で扱う）
 */
export function depthFromOutput(
  output: Record<string, TensorData>,
  photoWidth: number,
  photoHeight: number,
  vfovDeg: number
): DepthMap {
  const rotate = photoHeight > photoWidth;
  const points = output.points.data; // [1, H, W, 3]
  const mask = output.mask.data; // [1, H, W]、写っている所ほど 1 に近い
  const metricScale = output.metric_scale.data[0];

  // 回したあとの（モデルに入れた）写真の縦横比と横の画角。縦長を回したなら、元の縦が横になる
  const aspect = modelAspect(photoWidth, photoHeight);
  const halfVertical = Math.tan((vfovDeg * Math.PI) / 360);
  const halfHorizontal = rotate ? halfVertical : halfVertical * aspect;
  // 焦点距離（写真の対角の半分を 1 とした長さ）。本家の infer と同じ
  const focal = aspect / Math.sqrt(1 + aspect * aspect) / halfHorizontal;

  // 64×64 に最近傍で間引き、写っている所だけで shift を解く
  const { x: xs, y: ys, z: zs, u: us, v: vs } = gridSamples(output);
  if (zs.length < 2) throw new Error('写真の奥行きを出せませんでした');
  const shift = solveShift(xs, ys, zs, us, vs, focal);

  // 奥行き（m）。回したなら元の向きに戻す
  const width = rotate ? INPUT_HEIGHT : INPUT_WIDTH;
  const height = rotate ? INPUT_WIDTH : INPUT_HEIGHT;
  const data = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const source = rotate ? column * INPUT_WIDTH + (INPUT_WIDTH - 1 - row) : row * INPUT_WIDTH + column;
      const depth = (points[source * 3 + 2] + shift) * metricScale;
      data[row * width + column] = mask[source] > 0.5 && depth > 0 ? depth : Number.NaN;
    }
  }
  return { width, height, data };
}
