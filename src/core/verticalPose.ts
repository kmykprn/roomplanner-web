/**
 * 「現実で垂直な線」2 本から、カメラの傾きを出す。
 *
 * 部屋の中の垂直な縁（壁の角・ドア枠・窓枠）は、3D ではすべて同じ向き＝重力方向。
 * そういう線は写真の上では **1 点に集まる**（消失点）。その点の向きがそのまま
 * 「上下の向き」になり、そこから見下ろし角と左右の傾きが決まる。
 *
 * **推定モデルは使わない。** 2 本の交点を出すだけの計算で、失敗しようがない。
 * 難しいのは「どれが本物の垂直か」を見分けるところで、それは人に任せている
 * （自動で選ぶとカーテンのひだに負ける。furniture3d の docs/08-floor-fit.md）。
 */

import { clampFloorFit, type FloorFit } from '@/core/floorFit';
import type { EdgeLine } from '@/core/edgeLines';

/**
 * 2 本が画面の上でこれだけ離れていないと、交点が定まらない。
 *
 * ほぼ平行な 2 本は、わずかな向きの誤差で交点が大きく動く。
 * 写真の幅に対する割合で見る
 */
const MIN_SEPARATION_RATIO = 0.12;

export interface VerticalPoseResult {
  fit: FloorFit;
  /** 消失点が写真の高さの何倍ぶん下にあるか。大きいほど水平に近い構え */
  distanceRatio: number;
}

/**
 * 2 本の垂直線から傾きを出す。離れが足りない、または計算できないときは null。
 *
 * @param focal 焦点距離（画素）。EXIF か画角の仮定から出す
 */
export function poseFromVerticals(
  a: EdgeLine,
  b: EdgeLine,
  focal: number,
  width: number,
  height: number
): VerticalPoseResult | null {
  // 画面の上で十分に離れているか。同じ高さでの横位置で見る
  const y = (a.y1 + a.y2 + b.y1 + b.y2) / 4;
  if (Math.abs(xAt(a, y) - xAt(b, y)) < MIN_SEPARATION_RATIO * width) return null;

  const point = cross(homogeneous(a), homogeneous(b));
  if (Math.abs(point[2]) < 1e-12) {
    // 完全に平行＝消失点が無限遠＝カメラは水平。左右の傾きだけが残る
    const slope = (a.x2 - a.x1) / Math.max(1e-6, a.y2 - a.y1);
    return {
      fit: clampFloorFit({ pitchDeg: 0, rollDeg: toDegrees(Math.atan(slope)) }),
      distanceRatio: Infinity,
    };
  }

  const vanishing = { x: point[0] / point[2], y: point[1] / point[2] };
  // 消失点の向き（カメラ座標）。これが「下向き」になる
  let direction = normalize([
    (vanishing.x - width / 2) / focal,
    (vanishing.y - height / 2) / focal,
    1,
  ]);
  // 上向きに揃える（床の法線と同じ向きにする）
  if (direction[1] > 0) direction = direction.map((v) => -v) as [number, number, number];

  // 上向きベクトルから角度に戻す。見下ろし角は z 成分そのもの、
  // 左右の傾きは「画面の上」から見た x と y の比で出す。
  // ここを asin(x) で済ませると、見下ろしている分だけ答えが小さく出る
  return {
    fit: clampFloorFit({
      pitchDeg: toDegrees(Math.asin(-direction[2])),
      rollDeg: toDegrees(Math.atan2(direction[0], -direction[1])),
    }),
    distanceRatio: Math.abs(vanishing.y - height / 2) / height,
  };
}

/** その高さでの線の横位置 */
function xAt(line: EdgeLine, y: number): number {
  const slope = (line.x2 - line.x1) / Math.max(1e-6, line.y2 - line.y1);
  return line.x1 + slope * (y - line.y1);
}

/** 線分を通る直線の同次座標（2 点の外積） */
function homogeneous(line: EdgeLine): [number, number, number] {
  return cross([line.x1, line.y1, 1], [line.x2, line.y2, 1]);
}

function cross(p: number[], q: number[]): [number, number, number] {
  return [
    p[1] * q[2] - p[2] * q[1],
    p[2] * q[0] - p[0] * q[2],
    p[0] * q[1] - p[1] * q[0],
  ];
}

function normalize(v: number[]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}
