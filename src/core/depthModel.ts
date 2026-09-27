/**
 * 写真の奥行き（カメラから各点までの距離）を出す（MoGe-2 ViT-S のネットワーク部分をブラウザで動かす）。
 *
 * 流れ:
 *   1. 写真を 560×420 に縮める。縦長の写真は 90° 回して横長にしてから縮める
 *      （モデルはこの大きさ専用。16:9 などは引き伸ばして入れる。精度はほぼ落ちないことを確かめた）
 *   2. ネットワークで「点の地図」「写っている所」「実寸への倍率」を出す（端末の中で数秒〜数十秒）
 *   3. 画角が分かっている前提で、点の地図の奥行きのずれを最小二乗で直し、倍率を掛けて m にする
 *      （本家 MoGeModel.infer(fov_x=…) と同じ後処理）
 *
 * **写真は端末の外に出ない。** モデル（約 44MB）は初回だけ落とす（core/onnxModel.ts）。
 * モデルは重みだけを int8 で持ち、計算は fp32 のまま。ふつうの int8 化はブラウザでは 5 倍遅くなった。
 */

import { decodePhoto, loadModel, runModel, toInputPlanes, type DownloadProgress, type TensorData } from '@/core/onnxModel';

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

/** モデルを先に落としておく（落とす進み具合を出すため、推定とは分けて呼べるようにしている） */
export function loadDepthModel(onProgress?: (progress: DownloadProgress) => void): Promise<void> {
  return loadModel(MODEL_FILE, onProgress);
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

/**
 * 写真の URL と縦の画角（度）から、奥行きの地図を返す。数秒〜数十秒かかる
 */
export async function estimateDepth(url: string, vfovDeg: number): Promise<DepthMap> {
  const image = await decodePhoto(url);
  const photoWidth = image.naturalWidth;
  const photoHeight = image.naturalHeight;
  const rotate = photoHeight > photoWidth;

  const input = preprocess(image, rotate);
  const output = await runModel(MODEL_FILE, { image: { data: input, dims: [1, 3, INPUT_HEIGHT, INPUT_WIDTH] } });
  return depthFromOutput(output, photoWidth, photoHeight, vfovDeg);
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
  const aspect = rotate ? photoHeight / photoWidth : photoWidth / photoHeight;
  const halfVertical = Math.tan((vfovDeg * Math.PI) / 360);
  const halfHorizontal = rotate ? halfVertical : halfVertical * aspect;
  // 焦点距離（写真の対角の半分を 1 とした長さ）。本家の infer と同じ
  const focal = aspect / Math.sqrt(1 + aspect * aspect) / halfHorizontal;

  // 入力の各画素の、写真の面の上の位置（対角の半分を 1 とする）。本家の normalized_view_plane_uv と同じ
  const inputAspect = INPUT_WIDTH / INPUT_HEIGHT;
  const spanX = inputAspect / Math.sqrt(1 + inputAspect * inputAspect);
  const spanY = 1 / Math.sqrt(1 + inputAspect * inputAspect);

  // 64×64 に最近傍で間引き、写っている所だけで shift を解く
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const us: number[] = [];
  const vs: number[] = [];
  for (let gy = 0; gy < SHIFT_GRID; gy += 1) {
    const row = Math.floor((gy * INPUT_HEIGHT) / SHIFT_GRID);
    for (let gx = 0; gx < SHIFT_GRID; gx += 1) {
      const column = Math.floor((gx * INPUT_WIDTH) / SHIFT_GRID);
      const index = row * INPUT_WIDTH + column;
      if (mask[index] <= 0.5) continue;
      xs.push(points[index * 3]);
      ys.push(points[index * 3 + 1]);
      zs.push(points[index * 3 + 2]);
      us.push(spanX * ((2 * column + 1) / INPUT_WIDTH - 1));
      vs.push(spanY * ((2 * row + 1) / INPUT_HEIGHT - 1));
    }
  }
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
