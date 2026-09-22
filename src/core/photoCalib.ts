/**
 * 写真からカメラの画角と傾きを出す（GeoCalib の最適化部分の移植）。
 *
 * GeoCalib は 2 段でできている。
 *
 *   1. ネットワークが、全画素について「上はどっちか（上向きの場）」と
 *      「視線は水平から何度か（緯度の場）」を、自信の度合いつきで当てる
 *   2. その場を最もよく説明する「焦点距離 f・重力の向き（ロール・ピッチ）」を
 *      Levenberg–Marquardt で解く
 *
 * ここは 2 の部分。1 は ONNX にしたモデルをブラウザで動かす（core/photoCalibModel.ts）。
 * 未知数は 3 つ（ロール・ピッチ・log f）なので、ヤコビ行列は数値微分で足りる。
 *
 * 座標の決まりは GeoCalib に合わせる。画像座標は x が右・y が下・z が前。
 * 「重力」と呼んでいるベクトルは実際には**上向き**（ロール 0・ピッチ 0 で (0, −1, 0)）。
 * ピッチは「上向きの z 成分」で、見下ろすと負になる。
 *
 * 出典: Veicht et al., "GeoCalib: Learning Single-image Calibration with Geometric
 * Optimization", ECCV 2024. コードは Apache-2.0、学習済み重みは CC-BY-4.0。
 */

/** ネットワークが出した場。縮小後の画素数で持つ */
export interface CalibFields {
  width: number;
  height: number;
  /** 上向きの場。[2][height][width] を平らにしたもの（x 成分が先、y 成分が後） */
  up: Float32Array;
  /** 上向きの自信。[height][width] */
  upConfidence: Float32Array;
  /** 緯度の場（ラジアン）。[height][width] */
  latitude: Float32Array;
  /** 緯度の自信。[height][width] */
  latitudeConfidence: Float32Array;
}

export interface CalibResult {
  /** 焦点距離（場と同じ画素数での値）。元の写真の画素数に直すには縮小率で割る */
  focalPx: number;
  /** 縦の画角（度） */
  vfovDeg: number;
  /** 見下ろし角（度）。正で見下ろし。アプリの floorFit と同じ向き */
  pitchDeg: number;
  /** ロール（度）。GeoCalib の向きのまま（アプリ側で符号を合わせる） */
  rollDeg: number;
  /** 最後の重み付き誤差。大きいほど写真が場で説明できていない */
  cost: number;
  iterations: number;
}

/** LM の設定。GeoCalib の既定値と同じ */
const NUM_STEPS = 30;
const LAMBDA_INIT = 0.1;
const LAMBDA_MIN = 1e-6;
const LAMBDA_MAX = 1e2;
/** Huber 損失の切り替え点（残差の二乗に対して）。GeoCalib の up/lat_loss_fn_scale */
const HUBER_SCALE = 1e-2;
/** 全画素は要らない。間引いても答えは変わらず、時間が 1/4 になる */
const PIXEL_STRIDE = 2;
/** 数値微分の刻み */
const STEP_ANGLE = 1e-4;
const STEP_LOG_F = 1e-4;

interface Params {
  roll: number;
  pitch: number;
  logF: number;
}

/** 上向きベクトル（GeoCalib の Gravity.from_rp と同じ） */
function upVector(p: Params): [number, number, number] {
  const sr = Math.sin(p.roll);
  const cr = Math.cos(p.roll);
  const sp = Math.sin(p.pitch);
  const cp = Math.cos(p.pitch);
  return [-sr * cp, -cr * cp, sp];
}

/**
 * ある画素での残差（上向き 2 成分、sin 緯度 1 成分）を out に書く。
 * 予測の場（ネットワーク）と、パラメータから計算した場の差
 */
function residualsAt(
  fields: CalibFields,
  p: Params,
  index: number,
  x: number,
  y: number,
  out: Float64Array
): void {
  const f = Math.exp(p.logF);
  const [a, b, c] = upVector(p);
  const u = (x + 0.5 - fields.width / 2) / f;
  const v = (y + 0.5 - fields.height / 2) / f;

  // 上向きの場: 上向きベクトルを画素の位置で画面に射影したもの
  let px = a - c * u;
  let py = b - c * v;
  const n = Math.hypot(px, py) || 1;
  px /= n;
  py /= n;
  const n2 = fields.width * fields.height;
  out[0] = fields.up[index] - px;
  out[1] = fields.up[n2 + index] - py;

  // 緯度の場: 視線と上向きの内積が sin(緯度)
  const sinLat = (u * a + v * b + c) / Math.sqrt(u * u + v * v + 1);
  out[2] = Math.sin(fields.latitude[index]) - sinLat;
}

/** Huber 損失を「残差の二乗」に掛ける。返すのは（損失, 一階微分＝重み） */
function huber(sq: number): [number, number] {
  const x = sq / HUBER_SCALE;
  if (x < 1) return [x * HUBER_SCALE, 1];
  const s = Math.sqrt(x);
  return [(2 * s - 1) * HUBER_SCALE, 1 / s];
}

/** 間引いた画素の並び */
function samplePixels(fields: CalibFields): { index: Int32Array; x: Int32Array; y: Int32Array } {
  const xs: number[] = [];
  const ys: number[] = [];
  const ids: number[] = [];
  for (let y = 0; y < fields.height; y += PIXEL_STRIDE) {
    for (let x = 0; x < fields.width; x += PIXEL_STRIDE) {
      xs.push(x);
      ys.push(y);
      ids.push(y * fields.width + x);
    }
  }
  return { index: Int32Array.from(ids), x: Int32Array.from(xs), y: Int32Array.from(ys) };
}

/**
 * 全画素の重み付き誤差と、必要なら正規方程式（H, G）を溜める。
 * 重みは Huber の一階微分 × ネットワークの自信
 */
function accumulate(
  fields: CalibFields,
  p: Params,
  pixels: ReturnType<typeof samplePixels>,
  withSystem: boolean
): { cost: number; H: Float64Array; G: Float64Array } {
  const H = new Float64Array(9);
  const G = new Float64Array(3);
  let cost = 0;
  const r = new Float64Array(3);
  const rp = new Float64Array(3);
  const rm = new Float64Array(3);
  const J = new Float64Array(9); // 3 残差 × 3 パラメータ
  const steps: [keyof Params, number][] = [
    ['roll', STEP_ANGLE],
    ['pitch', STEP_ANGLE],
    ['logF', STEP_LOG_F],
  ];

  for (let k = 0; k < pixels.index.length; k += 1) {
    const i = pixels.index[k];
    residualsAt(fields, p, i, pixels.x[k], pixels.y[k], r);
    const [upCost, upW] = huber(r[0] * r[0] + r[1] * r[1]);
    const [latCost, latW] = huber(r[2] * r[2]);
    const wUp = upW * fields.upConfidence[i];
    const wLat = latW * fields.latitudeConfidence[i];
    cost += upCost * fields.upConfidence[i] + latCost * fields.latitudeConfidence[i];
    if (!withSystem) continue;

    // 数値微分でヤコビ行列
    for (let j = 0; j < 3; j += 1) {
      const [key, h] = steps[j];
      const plus = { ...p, [key]: p[key] + h };
      const minus = { ...p, [key]: p[key] - h };
      residualsAt(fields, plus, i, pixels.x[k], pixels.y[k], rp);
      residualsAt(fields, minus, i, pixels.x[k], pixels.y[k], rm);
      for (let m = 0; m < 3; m += 1) J[m * 3 + j] = (rp[m] - rm[m]) / (2 * h);
    }
    const w = [wUp, wUp, wLat];
    for (let m = 0; m < 3; m += 1) {
      for (let a = 0; a < 3; a += 1) {
        G[a] += w[m] * J[m * 3 + a] * r[m];
        for (let b = 0; b < 3; b += 1) H[a * 3 + b] += w[m] * J[m * 3 + a] * J[m * 3 + b];
      }
    }
  }
  return { cost, H, G };
}

/** 3×3 の連立方程式 A x = rhs を解く（クラメルの公式で十分） */
function solve3(A: Float64Array, rhs: Float64Array): Float64Array | null {
  const det =
    A[0] * (A[4] * A[8] - A[5] * A[7]) -
    A[1] * (A[3] * A[8] - A[5] * A[6]) +
    A[2] * (A[3] * A[7] - A[4] * A[6]);
  if (Math.abs(det) < 1e-18) return null;
  const inv = new Float64Array([
    A[4] * A[8] - A[5] * A[7], A[2] * A[7] - A[1] * A[8], A[1] * A[5] - A[2] * A[4],
    A[5] * A[6] - A[3] * A[8], A[0] * A[8] - A[2] * A[6], A[2] * A[3] - A[0] * A[5],
    A[3] * A[7] - A[4] * A[6], A[1] * A[6] - A[0] * A[7], A[0] * A[4] - A[1] * A[3],
  ]).map((v) => v / det);
  return new Float64Array([
    inv[0] * rhs[0] + inv[1] * rhs[1] + inv[2] * rhs[2],
    inv[3] * rhs[0] + inv[4] * rhs[1] + inv[5] * rhs[2],
    inv[6] * rhs[0] + inv[7] * rhs[1] + inv[8] * rhs[2],
  ]);
}

/** 場からカメラの画角と傾きを解く */
export function calibrateFromFields(fields: CalibFields): CalibResult {
  const pixels = samplePixels(fields);
  // 初期値は GeoCalib と同じ: ロール 0・ピッチ 0・f = 0.7 × 長辺
  let p: Params = { roll: 0, pitch: 0, logF: Math.log(0.7 * Math.max(fields.width, fields.height)) };
  let lambda = LAMBDA_INIT;
  let { cost, H, G } = accumulate(fields, p, pixels, true);
  let iterations = 0;

  for (let step = 0; step < NUM_STEPS; step += 1) {
    iterations = step + 1;
    // 対角を λ 倍だけ強めて、谷の底へ向かう一歩を解く
    const A = new Float64Array(H);
    for (let d = 0; d < 3; d += 1) A[d * 4] += lambda * H[d * 4] + 1e-9;
    const delta = solve3(A, G);
    if (!delta) break;
    const next: Params = { roll: p.roll - delta[0], pitch: p.pitch - delta[1], logF: p.logF - delta[2] };
    const trial = accumulate(fields, next, pixels, true);
    if (trial.cost < cost) {
      // 良くなった。歩幅を広げる
      const improved = cost - trial.cost;
      p = next;
      ({ cost, H, G } = trial);
      lambda = Math.max(LAMBDA_MIN, lambda / 10);
      if (improved < 1e-8 + 1e-8 * cost) break;
    } else {
      // 悪くなった。歩幅を狭めてやり直す
      lambda = Math.min(LAMBDA_MAX, lambda * 10);
    }
  }

  const f = Math.exp(p.logF);
  return {
    focalPx: f,
    vfovDeg: (2 * Math.atan(fields.height / (2 * f)) * 180) / Math.PI,
    // GeoCalib のピッチは見下ろすと負。アプリは見下ろしを正にしている
    pitchDeg: (-p.pitch * 180) / Math.PI,
    rollDeg: (p.roll * 180) / Math.PI,
    cost,
    iterations,
  };
}
