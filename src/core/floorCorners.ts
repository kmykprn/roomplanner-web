/**
 * 写真の床に置いた「四隅」から、カメラの傾きと高さを出す。
 *
 * 利用者は写真の上のマス目の四隅を動かして、床の上の長方形（床板の継ぎ目・ラグの縁・
 * 壁と床の境目など、直角に交わる 2 方向の線）に重ねる。重なったとき、
 *
 *   向かい合う 2 辺の延長が交わる点 … 床の上の 1 方向（消失点）
 *   2 方向の外積                   … 床の法線 → 見下ろし角と左右の傾き
 *
 * が決まる。画角は写真の解析（core/photoCalib.ts）で出たものを使う。
 * 辺の 1 本の実際の長さが分かれば、カメラの高さ（写真の縮尺）も決まる。
 * 分からなければ立って撮った高さ（CAMERA_HEIGHT）のまま。
 *
 * 計算はカメラの座標で行う（x 右・y 上・z 手前、見ている向きが −z）。
 * カメラの回し方は interaction/photoCamera.ts と同じ（YXZ、x = −見下ろし角、z = 左右の傾き）。
 */

import { clampFloorFit, type FloorFit } from '@/core/floorFit';
import type { PhotoPoint } from '@/core/photoView';

type Vec = [number, number, number];

/** 四隅。手前左・手前右・奥右・奥左の順（写真の中の割合） */
export type FloorCorners = [PhotoPoint, PhotoPoint, PhotoPoint, PhotoPoint];

/** 辺の番号。0 手前・1 右・2 奥・3 左。辺 i は角 i と角 i+1 を結ぶ */
export type CornerEdge = 0 | 1 | 2 | 3;

/** 写真を描いているカメラの画角 */
export interface Lens {
  /** 縦の画角（度） */
  vfovDeg: number;
  /** 幅 ÷ 高さ */
  aspect: number;
}

/** カメラの高さとして受け付ける範囲（m）。床すれすれから、脚立の上まで */
export const CAMERA_HEIGHT_LIMITS = { min: 0.3, max: 3 };

const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec): number => Math.hypot(a[0], a[1], a[2]);
const toRad = (degrees: number): number => (degrees * Math.PI) / 180;
const toDeg = (radians: number): number => (radians * 180) / Math.PI;

/** 写真の点から、カメラの座標での視線の向き */
function rayOf(point: PhotoPoint, lens: Lens): Vec {
  const t = Math.tan(toRad(lens.vfovDeg) / 2);
  return [(point.x * 2 - 1) * t * lens.aspect, (1 - point.y * 2) * t, -1];
}

/** カメラの座標 → 世界の座標（カメラの位置は原点のまま、向きだけ回す）。YXZ の順 */
function toWorld(v: Vec, fit: FloorFit): Vec {
  const r = toRad(fit.rollDeg);
  const a = toRad(-fit.pitchDeg);
  // まず Z（左右の傾き）、次に X（見下ろし）
  const x1 = v[0] * Math.cos(r) - v[1] * Math.sin(r);
  const y1 = v[0] * Math.sin(r) + v[1] * Math.cos(r);
  return [x1, y1 * Math.cos(a) - v[2] * Math.sin(a), y1 * Math.sin(a) + v[2] * Math.cos(a)];
}

/** 世界の座標 → カメラの座標。toWorld の逆 */
function toCamera(v: Vec, fit: FloorFit): Vec {
  const r = toRad(fit.rollDeg);
  const a = toRad(-fit.pitchDeg);
  const y1 = v[1] * Math.cos(a) + v[2] * Math.sin(a);
  const z1 = -v[1] * Math.sin(a) + v[2] * Math.cos(a);
  return [v[0] * Math.cos(r) + y1 * Math.sin(r), -v[0] * Math.sin(r) + y1 * Math.cos(r), z1];
}

/**
 * 四隅から床の傾きを出す。四隅がほぼ一直線に並ぶなど、決まらないときは null。
 *
 * 辺を延ばした交点は、視線どうしの「面」の交わりとして求める（外積を 2 回）。
 * 写真の中で平行な 2 辺でも、無限遠の交点として同じ式で扱える
 */
export function solveFloorFit(corners: FloorCorners, lens: Lens): FloorFit | null {
  const [p0, p1, p2, p3] = corners.map((corner) => rayOf(corner, lens));
  // 手前と奥の辺が向かう方向、左と右の辺が向かう方向
  const across = cross(cross(p0, p1), cross(p3, p2));
  const along = cross(cross(p0, p3), cross(p1, p2));
  let normal = cross(across, along);
  const size = length(normal);
  if (!(size > 1e-9)) return null;
  normal = normal.map((value) => value / size) as Vec;
  // 上向き（カメラの座標で y が正の側）にそろえる
  if (normal[1] < 0) normal = normal.map((value) => -value) as Vec;
  // カメラから見た上向きは (cos p·sin r, cos p·cos r, sin p)（p 見下ろし角、r 左右の傾き）
  const fit = {
    pitchDeg: toDeg(Math.asin(Math.max(-1, Math.min(1, normal[2])))),
    rollDeg: toDeg(Math.atan2(normal[0], normal[1])),
  };
  if (!Number.isFinite(fit.pitchDeg) || !Number.isFinite(fit.rollDeg)) return null;
  return clampFloorFit(fit);
}

/** 写真の点に見えている床の位置（カメラの真下を原点とする）。床より上を向いていれば null */
function floorPointOf(point: PhotoPoint, fit: FloorFit, lens: Lens, height: number): Vec | null {
  const direction = toWorld(rayOf(point, lens), fit);
  if (direction[1] >= -1e-6) return null;
  const t = height / -direction[1];
  return [direction[0] * t, -height, direction[2] * t];
}

/**
 * 辺の実際の長さから、カメラの高さを出す。
 * 辺の両端が床に当たらない（地平線より上にある）ときは null
 */
export function cameraHeightFor(
  corners: FloorCorners,
  edge: CornerEdge,
  realLength: number,
  fit: FloorFit,
  lens: Lens
): number | null {
  // 高さ 1 m で測った長さと実際の長さの比が、そのまま高さになる
  const a = floorPointOf(corners[edge], fit, lens, 1);
  const b = floorPointOf(corners[(edge + 1) % 4], fit, lens, 1);
  if (!a || !b) return null;
  const measured = Math.hypot(a[0] - b[0], a[2] - b[2]);
  if (!(measured > 1e-6)) return null;
  const height = realLength / measured;
  return Math.min(CAMERA_HEIGHT_LIMITS.max, Math.max(CAMERA_HEIGHT_LIMITS.min, height));
}

/** 床の位置を写真の点に写す */
function photoPointOf(world: Vec, fit: FloorFit, lens: Lens): PhotoPoint {
  const camera = toCamera(world, fit);
  const t = Math.tan(toRad(lens.vfovDeg) / 2);
  const x = camera[0] / -camera[2] / (t * lens.aspect);
  const y = camera[1] / -camera[2] / t;
  return { x: (x + 1) / 2, y: (1 - y) / 2 };
}

/** 写真のうち画面に見えている範囲（写真の中の割合）。四隅はこの中に出す */
export interface VisibleRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 最初に出す四隅。いまの傾きで、床の上の長方形を写真に写したもの。
 *
 * **見えている範囲の中に出す。** 写真は画面を覆うように敷くので、上下か左右が
 * 切れている。写真全体の割合で置くと、角が画面の外に出て掴めない。
 * 手前の辺は見えている範囲の下から 1 割、奥の辺は下から 4 割あたりの床に置き、
 * 幅は手前の辺が見えている幅の 6〜7 割ほどになるようにする
 */
export function defaultCorners(
  fit: FloorFit,
  lens: Lens,
  region: VisibleRegion = { x: 0, y: 0, width: 1, height: 1 }
): FloorCorners {
  const inRegion = (u: number, v: number): PhotoPoint => ({
    x: region.x + u * region.width,
    y: region.y + v * region.height,
  });
  const near = floorPointOf(inRegion(0.5, 0.88), fit, lens, 1);
  const far = floorPointOf(inRegion(0.5, 0.62), fit, lens, 1);
  // 傾きが水平より上を向いているなど、床が見えないときは見えている範囲の下半分に台形を置くだけ
  if (!near) {
    return [inRegion(0.2, 0.9), inRegion(0.8, 0.9), inRegion(0.65, 0.65), inRegion(0.35, 0.65)];
  }
  const nearZ = near[2];
  const farZ = far ? far[2] : nearZ * 2;
  const halfWidth =
    0.95 * Math.abs(nearZ) * Math.tan(toRad(lens.vfovDeg) / 2) * lens.aspect * region.width;
  const at = (x: number, z: number): PhotoPoint => photoPointOf([x + near[0], -1, z], fit, lens);
  return [at(-halfWidth, nearZ), at(halfWidth, nearZ), at(halfWidth, farZ), at(-halfWidth, farZ)];
}

/** 保存した四隅を読み戻す。形が崩れていれば null */
export function normalizeCorners(value: unknown): FloorCorners | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const ok = value.every(
    (point) => point && Number.isFinite((point as PhotoPoint).x) && Number.isFinite((point as PhotoPoint).y)
  );
  return ok ? (value.map((point: PhotoPoint) => ({ x: point.x, y: point.y })) as FloorCorners) : null;
}
