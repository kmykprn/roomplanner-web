/**
 * 写真の奥行きから、写真の中の点の 3D の位置を出す（家具を足元の奥行きに合わせて置くため）。
 *
 * 考え方: 画面に写る家具の大きさは「家具の実際の大きさ ÷ カメラからの距離」で決まる。
 * 家具の足元の点の奥行きが分かれば、その点に家具を立たせるだけで、見た目の大きさが写真と合う。
 * 床の平面やカメラの高さは使わない。
 *
 * 奥行きのモデルが出す値は実寸に近いが、そのままでは 20〜30% ずれる。そこで寸法の線の長さに
 * 合うように、奥行き d を a·d + b に直してから使う（線 1 本なら倍率 a だけ、2 本以上なら a と b）。
 *
 * 座標はカメラの向きを interaction/photoCamera.ts と同じにしている
 * （カメラは (0, 高さ, 4) にいて、YXZ の順に x = −見下ろし角、z = 左右の傾きだけ回す）。
 */

import type { DepthMap } from '@/core/depthModel';
import type { FloorFit } from '@/core/floorFit';
import type { PhotoPoint } from '@/core/photoView';
import type { ScaleLine } from '@/core/scaleLine';

type Vec = [number, number, number];

/** 写真を描いているカメラの画角 */
export interface Lens {
  /** 縦の画角（度） */
  vfovDeg: number;
  /** 幅 ÷ 高さ */
  aspect: number;
}

/** 写真を描いているカメラの向きと位置 */
export interface PhotoPose {
  fit: FloorFit;
  /** カメラの位置（3D の座標） */
  position: Vec;
}

/** 奥行きの直し方。本当の奥行き ≒ a × モデルの奥行き + b */
export interface DepthScale {
  a: number;
  b: number;
}

/** 足元の奥行きを取るときに見る範囲（奥行きの地図の画素、一辺）。1 画素だと物の縁でばらつく */
const SAMPLE_WINDOW = 5;
/** 範囲の中で、奥行きの分かる画素がこれだけ無ければ「分からない」とする */
const MIN_SAMPLES = 5;

const toRad = (degrees: number): number => (degrees * Math.PI) / 180;

/** 写真の点から、カメラの座標での視線の向き（正面方向の奥行きが 1 になる長さ） */
function rayOf(point: PhotoPoint, lens: Lens): Vec {
  const t = Math.tan(toRad(lens.vfovDeg) / 2);
  return [(point.x * 2 - 1) * t * lens.aspect, (1 - point.y * 2) * t, -1];
}

/** カメラの座標 → 3D の座標（向きだけ回す）。YXZ の順 */
function toWorld(v: Vec, fit: FloorFit): Vec {
  const r = toRad(fit.rollDeg);
  const a = toRad(-fit.pitchDeg);
  const x1 = v[0] * Math.cos(r) - v[1] * Math.sin(r);
  const y1 = v[0] * Math.sin(r) + v[1] * Math.cos(r);
  return [x1, y1 * Math.cos(a) - v[2] * Math.sin(a), y1 * Math.sin(a) + v[2] * Math.cos(a)];
}

/** 3D の座標 → カメラの座標。toWorld の逆 */
function toCamera(v: Vec, fit: FloorFit): Vec {
  const r = toRad(fit.rollDeg);
  const a = toRad(-fit.pitchDeg);
  const y1 = v[1] * Math.cos(a) + v[2] * Math.sin(a);
  const z1 = -v[1] * Math.sin(a) + v[2] * Math.cos(a);
  return [v[0] * Math.cos(r) + y1 * Math.sin(r), -v[0] * Math.sin(r) + y1 * Math.cos(r), z1];
}

/** 写真の点の、モデルの奥行き（m）。まわり 5×5 画素の中央値。分からなければ null */
export function depthAt(map: DepthMap, point: PhotoPoint): number | null {
  const column = Math.floor(point.x * map.width);
  const row = Math.floor(point.y * map.height);
  const half = Math.floor(SAMPLE_WINDOW / 2);
  const values: number[] = [];
  for (let dy = -half; dy <= half; dy += 1) {
    for (let dx = -half; dx <= half; dx += 1) {
      const x = column + dx;
      const y = row + dy;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      const value = map.data[y * map.width + x];
      if (Number.isFinite(value)) values.push(value);
    }
  }
  if (values.length < MIN_SAMPLES) return null;
  values.sort((p, q) => p - q);
  return values[Math.floor(values.length / 2)];
}

/** 写真の点の、カメラの座標での 3D の位置（奥行きを直したあと）。奥行きが分からなければ null */
function cameraPointAt(point: PhotoPoint, map: DepthMap, scale: DepthScale, lens: Lens): Vec | null {
  const raw = depthAt(map, point);
  if (raw === null) return null;
  const depth = scale.a * raw + scale.b;
  if (!(depth > 0)) return null;
  const ray = rayOf(point, lens);
  return [ray[0] * depth, ray[1] * depth, ray[2] * depth];
}

/** 写真の点に写っている物の、3D の位置。奥行きが分からなければ null */
export function worldPointAt(
  point: PhotoPoint,
  map: DepthMap,
  scale: DepthScale,
  lens: Lens,
  pose: PhotoPose
): Vec | null {
  const camera = cameraPointAt(point, map, scale, lens);
  if (!camera) return null;
  const world = toWorld(camera, pose.fit);
  return [world[0] + pose.position[0], world[1] + pose.position[1], world[2] + pose.position[2]];
}

/** 3D の位置が写る、写真の点。カメラの後ろなら null */
export function photoPointOf(world: Vec, lens: Lens, pose: PhotoPose): PhotoPoint | null {
  const camera = toCamera(
    [world[0] - pose.position[0], world[1] - pose.position[1], world[2] - pose.position[2]],
    pose.fit
  );
  if (camera[2] >= -1e-6) return null;
  const t = Math.tan(toRad(lens.vfovDeg) / 2);
  const x = camera[0] / -camera[2] / (t * lens.aspect);
  const y = camera[1] / -camera[2] / t;
  return { x: (x + 1) / 2, y: (1 - y) / 2 };
}

/** 線の両端の視線と、モデルの奥行き。どちらかの端の奥行きが分からなければ null */
interface LineSample {
  rayA: Vec;
  rayB: Vec;
  depthA: number;
  depthB: number;
  length: number;
}

/** 奥行きを直したときの、線の 3D の長さ */
function lengthOf(sample: LineSample, scale: DepthScale): number {
  const da = scale.a * sample.depthA + scale.b;
  const db = scale.a * sample.depthB + scale.b;
  return Math.hypot(
    sample.rayA[0] * da - sample.rayB[0] * db,
    sample.rayA[1] * da - sample.rayB[1] * db,
    sample.rayA[2] * da - sample.rayB[2] * db
  );
}

/** 各線の「長さの比 − 1」の 2 乗和。合わせ方の良し悪し */
function costOf(samples: LineSample[], scale: DepthScale): number {
  return samples.reduce((sum, sample) => sum + (lengthOf(sample, scale) / sample.length - 1) ** 2, 0);
}

/**
 * 倍率 a だけで合わせる（b = 0）。各線の「長さの比 − 1」の 2 乗和がいちばん小さい a。
 * b = 0 なら長さは a に比例するので、閉じた式で出る
 */
function fitScaleOnly(samples: LineSample[]): DepthScale {
  let numerator = 0;
  let denominator = 0;
  for (const sample of samples) {
    const ratio = lengthOf(sample, { a: 1, b: 0 }) / sample.length;
    numerator += ratio;
    denominator += ratio * ratio;
  }
  return { a: numerator / denominator, b: 0 };
}

/**
 * a と b の両方で合わせる。倍率だけで合わせた値から始め、減衰付きのガウス・ニュートン法で
 * 「長さの比 − 1」の 2 乗和を小さくする（未知数 2 つなので、微分は数値で取る）
 */
function fitScaleAndOffset(samples: LineSample[], start: DepthScale): DepthScale {
  let scale = start;
  let cost = costOf(samples, scale);
  let damping = 1e-3;
  const residuals = (s: DepthScale): number[] => samples.map((sample) => lengthOf(sample, s) / sample.length - 1);
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const r = residuals(scale);
    const stepA = 1e-6 * Math.max(1, Math.abs(scale.a));
    const stepB = 1e-6;
    const ra = residuals({ a: scale.a + stepA, b: scale.b });
    const rb = residuals({ a: scale.a, b: scale.b + stepB });
    // 2×2 の正規方程式 (JᵀJ + 減衰) Δ = −Jᵀr
    let jaa = 0;
    let jab = 0;
    let jbb = 0;
    let ga = 0;
    let gb = 0;
    for (let i = 0; i < r.length; i += 1) {
      const da = (ra[i] - r[i]) / stepA;
      const db = (rb[i] - r[i]) / stepB;
      jaa += da * da;
      jab += da * db;
      jbb += db * db;
      ga += da * r[i];
      gb += db * r[i];
    }
    const maa = jaa * (1 + damping);
    const mbb = jbb * (1 + damping);
    const determinant = maa * mbb - jab * jab;
    if (Math.abs(determinant) < 1e-18) break;
    const next = {
      a: scale.a + (-ga * mbb + gb * jab) / determinant,
      b: scale.b + (-gb * maa + ga * jab) / determinant,
    };
    const nextCost = costOf(samples, next);
    if (Number.isFinite(nextCost) && nextCost < cost) {
      const improved = cost - nextCost;
      scale = next;
      cost = nextCost;
      damping /= 10;
      if (improved < 1e-9) break;
    } else {
      damping *= 10;
      if (damping > 1e8) break;
    }
  }
  return scale;
}

/**
 * 寸法の線の長さに合うように、奥行きの直し方を決める。
 * 端の奥行きが分からない線が 1 本でもあれば null（その線を動かしてもらう）
 */
export function fitDepthScale(
  lines: (ScaleLine & { length: number })[],
  map: DepthMap,
  lens: Lens
): DepthScale | null {
  const samples: LineSample[] = [];
  for (const line of lines) {
    const depthA = depthAt(map, line.a);
    const depthB = depthAt(map, line.b);
    if (depthA === null || depthB === null) return null;
    samples.push({ rayA: rayOf(line.a, lens), rayB: rayOf(line.b, lens), depthA, depthB, length: line.length });
  }
  if (samples.length === 0) return null;

  const scaleOnly = fitScaleOnly(samples);
  if (samples.length === 1) return scaleOnly;
  const fitted = fitScaleAndOffset(samples, scaleOnly);
  // 直したあとの奥行きが、写真のどこかで 0 以下になるなら使わない（手前が裏返る）。倍率だけに戻す
  let nearest = Infinity;
  for (const value of map.data) if (value < nearest) nearest = value;
  return fitted.a > 0 && fitted.a * nearest + fitted.b > 0 ? fitted : scaleOnly;
}

/** 写真の点を通る視線が、高さ y の水平な面と交わる 3D の位置。交わらなければ（面の向こうを向いている）null */
export function levelPointAt(point: PhotoPoint, y: number, lens: Lens, pose: PhotoPose): Vec | null {
  const direction = toWorld(rayOf(point, lens), pose.fit);
  const t = (y - pose.position[1]) / direction[1];
  if (!Number.isFinite(t) || t <= 0) return null;
  return [pose.position[0] + direction[0] * t, y, pose.position[2] + direction[2] * t];
}

/** 撮った高さを見積もるときに見る範囲（写真の縦の割合）。床が写っていることが多い下のほう */
const FLOOR_SAMPLE_TOP = 0.66;
/** 見た点のうち、低い順にこの割合を床とみなす（壁の根元や窓枠など、床より高い物を外す） */
const FLOOR_SAMPLE_RATIO = 0.4;
/** 撮った高さとしてありうる範囲（m）。外れたら見積もれなかったことにする */
const CAMERA_HEIGHT_RANGE: [number, number] = [0.6, 2.5];

/**
 * 写真を撮った高さ（カメラから床までの m）を、解析した奥行きから見積もる。見積もれなければ null。
 *
 * **奥行きは高さを出すことだけに使い、床の形には使わない。** 解析した奥行きをそのまま 3D に直すと、
 * 床が数度傾く（奥行きの解析と傾きの解析で、想定する画角が違うため）。一方で、天井やドアの高さは
 * よく合う（実測で 5% 以内）。そこで床は「この高さの下にある水平な 1 枚の面」とし、写真の傾きは傾きの解析の値を使う。
 * 写真の下のほうの点を、カメラの真下からどれだけ下にあるかで並べ、低いほうの点の中央値を床の深さとする
 */
export function estimateCameraHeight(map: DepthMap, lens: Lens, fit: FloorFit): number | null {
  const drops: number[] = [];
  const atCamera: PhotoPose = { fit, position: [0, 0, 0] };
  for (let y = FLOOR_SAMPLE_TOP; y < 0.99; y += 0.02) {
    for (let x = 0.04; x < 0.97; x += 0.04) {
      const world = worldPointAt({ x, y }, map, { a: 1, b: 0 }, lens, atCamera);
      if (world) drops.push(-world[1]);
    }
  }
  if (drops.length < 20) return null;
  drops.sort((a, b) => b - a);
  const lowest = drops.slice(0, Math.max(1, Math.round(drops.length * FLOOR_SAMPLE_RATIO)));
  const height = lowest[Math.floor(lowest.length / 2)];
  return height >= CAMERA_HEIGHT_RANGE[0] && height <= CAMERA_HEIGHT_RANGE[1] ? height : null;
}
