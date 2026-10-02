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

/** 床の面を探すときの決まり */
const FLOOR_PLANE = {
  /** 写真のこの高さ（縦の割合）より下の点を使う。床はたいてい写真の下のほうに写る */
  top: 0.4,
  /** 点を間引く間隔（奥行きの地図の画素） */
  step: 2,
  /** 見つける面の数の上限（床・天板・ベッドの上など） */
  maxPlanes: 4,
  /** 1 枚の面を探すときに試す回数 */
  trials: 400,
  /** 面から 3 cm 以内の点を、その面の点とみなす */
  tolerance: 0.03,
  /**
   * 面の点がこの割合より少なければ、面とみなさない。小さな面は、奥行きの誤差でできた見かけの面のことがあり、
   * 試すたびに選ばれる面が変わった（5% では、本当の床より 0.7 m 下に面ができた画像があった）
   */
  minShare: 0.15,
  /** 仮の上向きと 15° 以内の面だけを、水平な面とみなす */
  levelDeg: 15,
  /** 選んだ床の向きが仮の上向きと 5° 以上違えば、床の面は使わない */
  agreeDeg: 5,
  /** 撮った高さがこれより低ければ、床の面は使わない（天板などを取り違えている） */
  minHeight: 0.6,
};

/** 決まった並びの乱数（同じ写真なら毎回同じ床の面になるように） */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 見下ろし角・傾きのときの、カメラの座標（x 右・y 上・−z 前）での上向き */
function upInCamera(fit: FloorFit): Vec {
  // toWorld はカメラ → 3D の回転。カメラの各軸が 3D で上（y）にどれだけ向くかが、カメラの座標での上向き
  return [toWorld([1, 0, 0], fit)[1], toWorld([0, 1, 0], fit)[1], toWorld([0, 0, 1], fit)[1]];
}

/** 3 次の対称行列のいちばん小さい固有値の固有ベクトル（ヤコビ法）。面の向きを点の散らばりから決めるのに使う */
function smallestEigenvector(m: number[][]): Vec {
  const a = m.map((row) => [...row]);
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep += 1) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-12) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k += 1) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k += 1) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k += 1) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const i = [0, 1, 2].reduce((best, k) => (a[k][k] < a[best][best] ? k : best), 0);
  return [v[0][i], v[1][i], v[2][i]];
}

/**
 * 写真の床の面から、カメラの見下ろし角・傾きと、撮った高さを出す。見つからない・怪しいときは null。
 *
 * **床と天板を取り違えないように選ぶ。** 奥行きの点からほぼ水平な面を何枚か見つけ、いちばん下の面を床とする。
 * 「水平」「下」の向きは、傾きの AI が出した見下ろし角・傾き（prior）を仮の基準にする。基準が数度ずれていても、
 * 床と天板の高さの差（0.4〜0.7 m）の方がずっと大きいので、上下の順番は入れ替わらない。
 * 選んだ床の向きが基準と大きく違う、または撮った高さが低すぎるときは、取り違えとみなして使わない。
 *
 * CG の部屋の画像 30 枚で、撮った高さの大外れ（悪い方から 1 割）が 60% から 30% に減り、
 * 家具の置き場所の大外れも減った（取り違えを見抜かないと、天板を床にして逆に悪くなった）
 */
export function findFloorPlane(map: DepthMap, lens: Lens, prior: FloorFit): { fit: FloorFit; cameraHeight: number } | null {
  const up0 = upInCamera(prior);
  // 写真の下 6 割の点を、カメラの座標の 3D の点にする
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let row = Math.floor(map.height * FLOOR_PLANE.top); row < map.height; row += FLOOR_PLANE.step) {
    for (let column = 0; column < map.width; column += FLOOR_PLANE.step) {
      const depth = map.data[row * map.width + column];
      if (!Number.isFinite(depth)) continue;
      const ray = rayOf({ x: (column + 0.5) / map.width, y: (row + 0.5) / map.height }, lens);
      xs.push(ray[0] * depth);
      ys.push(ray[1] * depth);
      zs.push(ray[2] * depth);
    }
  }
  const total = xs.length;
  if (total < 300) return null;
  const random = seededRandom(20261002);
  const remaining = new Uint8Array(total).fill(1);
  const cosLevel = Math.cos(toRad(FLOOR_PLANE.levelDeg));
  const planes: { normal: Vec; center: Vec }[] = [];

  for (let found = 0; found < FLOOR_PLANE.maxPlanes; found += 1) {
    const candidates: number[] = [];
    for (let i = 0; i < total; i += 1) if (remaining[i]) candidates.push(i);
    if (candidates.length < 200) break;
    const pick = (): number => candidates[Math.floor(random() * candidates.length)];
    let best: number[] | null = null;
    for (let trial = 0; trial < FLOOR_PLANE.trials; trial += 1) {
      const a = pick();
      const b = pick();
      const c = pick();
      const ab: Vec = [xs[b] - xs[a], ys[b] - ys[a], zs[b] - zs[a]];
      const ac: Vec = [xs[c] - xs[a], ys[c] - ys[a], zs[c] - zs[a]];
      let n: Vec = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const length = Math.hypot(...n);
      if (length < 1e-9) continue;
      n = [n[0] / length, n[1] / length, n[2] / length];
      let facing = n[0] * up0[0] + n[1] * up0[1] + n[2] * up0[2];
      if (facing < 0) {
        n = [-n[0], -n[1], -n[2]];
        facing = -facing;
      }
      if (facing < cosLevel) continue;
      const offset = n[0] * xs[a] + n[1] * ys[a] + n[2] * zs[a];
      const inliers = candidates.filter((i) => Math.abs(n[0] * xs[i] + n[1] * ys[i] + n[2] * zs[i] - offset) < FLOOR_PLANE.tolerance);
      if (!best || inliers.length > best.length) best = inliers;
    }
    if (!best || best.length < FLOOR_PLANE.minShare * total) break;
    // 面の点の中心と、点の散らばりがいちばん小さい向き（＝面の向き）
    const center: Vec = [0, 0, 0];
    for (const i of best) {
      center[0] += xs[i] / best.length;
      center[1] += ys[i] / best.length;
      center[2] += zs[i] / best.length;
    }
    const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const i of best) {
      const d = [xs[i] - center[0], ys[i] - center[1], zs[i] - center[2]];
      for (let r = 0; r < 3; r += 1) for (let k = 0; k < 3; k += 1) cov[r][k] += d[r] * d[k];
    }
    let normal = smallestEigenvector(cov);
    if (normal[0] * up0[0] + normal[1] * up0[1] + normal[2] * up0[2] < 0) normal = [-normal[0], -normal[1], -normal[2]];
    planes.push({ normal, center });
    for (const i of best) remaining[i] = 0;
  }
  if (planes.length === 0) return null;

  // 仮の上向きに沿って、いちばん下にある面を床とする
  const below = (center: Vec): number => -(center[0] * up0[0] + center[1] * up0[1] + center[2] * up0[2]);
  const floor = planes.reduce((lowest, plane) => (below(plane.center) > below(lowest.center) ? plane : lowest));
  const { normal, center } = floor;
  const cameraHeight = -(normal[0] * center[0] + normal[1] * center[1] + normal[2] * center[2]);
  const agree = (Math.acos(Math.min(1, normal[0] * up0[0] + normal[1] * up0[1] + normal[2] * up0[2])) * 180) / Math.PI;
  if (agree > FLOOR_PLANE.agreeDeg || cameraHeight < FLOOR_PLANE.minHeight) return null;
  // 床の向きから見下ろし角・傾き（見下ろすと上向きは +z 側に、右に傾けると +x 側に傾く。toWorld で確かめた向き）
  return {
    fit: { pitchDeg: (Math.asin(Math.max(-1, Math.min(1, normal[2]))) * 180) / Math.PI, rollDeg: (Math.atan2(normal[0], normal[1]) * 180) / Math.PI },
    cameraHeight,
  };
}
