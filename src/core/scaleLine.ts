/**
 * 「大きさを合わせる」線から、写真の縮尺（カメラの高さ）を出す。
 *
 * 写真 1 枚からは向き（傾き）と画角までしか分からず、カメラが床から何 m の高さに
 * あったかは分からない（既定は立って撮った 1.4 m）。利用者に写真の上の線 1 本を
 * 長さの分かる物に合わせてもらい、その実際の長さから高さを逆算する。
 *
 * 線の読み方は 2 通り。
 *
 *   幅   … 両端とも床の上。両端を床に落とし、その間の距離を測る
 *   高さ … 下の端が床に着いた、床から垂直に立つ物。下の端を床に落とし、
 *          その真上で上の端の視線がいちばん近づく高さを測る
 *
 * どちらかは線の向きで自動で決める（その場所での「真上」の向きにほぼ沿っていれば高さ）。
 * 利用者が選び直すこともできる。
 *
 * 計算はカメラを原点、世界の Y を上にした座標で行う（床は y = −カメラの高さ）。
 * カメラの回し方は interaction/photoCamera.ts と同じ（YXZ、x = −見下ろし角、z = 左右の傾き）。
 * いったん高さ 1 m として測り、実際の長さとの比がそのままカメラの高さになる。
 */

import type { FloorFit } from '@/core/floorFit';
import type { PhotoPoint } from '@/core/photoView';

type Vec = [number, number, number];

/** 写真を描いているカメラの画角 */
export interface Lens {
  /** 縦の画角（度） */
  vfovDeg: number;
  /** 幅 ÷ 高さ */
  aspect: number;
}

/** 線をどう読むか。auto は線の向きで決める */
export type ScaleKind = 'auto' | 'width' | 'height';

export interface ScaleLine {
  /** 両端（写真の中の割合） */
  a: PhotoPoint;
  b: PhotoPoint;
  kind: ScaleKind;
  /** 実際の長さ（m）。入れていなければ null（立って撮った高さのまま） */
  length: number | null;
}

/** 写真のうち画面に見えている範囲（写真の中の割合）。線はこの中に出す */
export interface VisibleRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** カメラの高さとして受け付ける範囲（m）。床すれすれから、脚立の上まで */
export const CAMERA_HEIGHT_LIMITS = { min: 0.3, max: 3 };

/**
 * 高さとみなす角度（度）。線と「真上」の向きのずれがこれ以内なら高さ。
 * 床の上を奥へ伸びる線も写真の中ではたてに近く写るので、広くしすぎない
 */
const VERTICAL_TOLERANCE_DEG = 12;

const toRad = (degrees: number): number => (degrees * Math.PI) / 180;

/** 写真の点から、カメラの座標での視線の向き */
function rayOf(point: PhotoPoint, lens: Lens): Vec {
  const t = Math.tan(toRad(lens.vfovDeg) / 2);
  return [(point.x * 2 - 1) * t * lens.aspect, (1 - point.y * 2) * t, -1];
}

/** カメラの座標 → 世界の座標（向きだけ回す）。YXZ の順 */
function toWorld(v: Vec, fit: FloorFit): Vec {
  const r = toRad(fit.rollDeg);
  const a = toRad(-fit.pitchDeg);
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

/** 写真の点に見えている床の位置（カメラの高さ 1 m として）。床より上を向いていれば null */
function floorPointOf(point: PhotoPoint, fit: FloorFit, lens: Lens): Vec | null {
  const direction = toWorld(rayOf(point, lens), fit);
  if (direction[1] >= -1e-6) return null;
  const t = 1 / -direction[1];
  return [direction[0] * t, -1, direction[2] * t];
}

/** 世界の位置を写真の点に写す */
function photoPointOf(world: Vec, fit: FloorFit, lens: Lens): PhotoPoint {
  const camera = toCamera(world, fit);
  const t = Math.tan(toRad(lens.vfovDeg) / 2);
  const x = camera[0] / -camera[2] / (t * lens.aspect);
  const y = camera[1] / -camera[2] / t;
  return { x: (x + 1) / 2, y: (1 - y) / 2 };
}

/** 画面の下にある方（床に着いているとみなす端）と、もう一方 */
function bottomAndTop(line: ScaleLine): [PhotoPoint, PhotoPoint] {
  return line.a.y >= line.b.y ? [line.a, line.b] : [line.b, line.a];
}

/**
 * 線を幅と高さのどちらで読むか。kind が auto なら線の向きで決める。
 *
 * 下の端に見えている床の位置から真上に 20 cm 伸ばした点を写真に写し、その向き（その場所での
 * 「真上」）と線の向きを比べる。写真の縦横比の違いを消すため、横は縦横比を掛けて比べる
 */
export function resolveKind(line: ScaleLine, fit: FloorFit, lens: Lens): 'width' | 'height' {
  if (line.kind !== 'auto') return line.kind;
  const [bottom, top] = bottomAndTop(line);
  const floor = floorPointOf(bottom, fit, lens);
  if (!floor) return 'width';
  const above = photoPointOf([floor[0], floor[1] + 0.2, floor[2]], fit, lens);
  const up = [(above.x - bottom.x) * lens.aspect, above.y - bottom.y];
  const along = [(top.x - bottom.x) * lens.aspect, top.y - bottom.y];
  const norm = Math.hypot(up[0], up[1]) * Math.hypot(along[0], along[1]);
  if (norm < 1e-12) return 'width';
  const cos = Math.abs(up[0] * along[0] + up[1] * along[1]) / norm;
  return cos >= Math.cos(toRad(VERTICAL_TOLERANCE_DEG)) ? 'height' : 'width';
}

/**
 * カメラの高さを 1 m としたときの、線の長さ（m）。測れないときは null。
 *
 *   幅   … 両端が床に当たらなければ測れない
 *   高さ … 下の端が床に当たらない、上の端が下の端より低い、などは測れない
 */
export function lengthAtUnitHeight(line: ScaleLine, kind: 'width' | 'height', fit: FloorFit, lens: Lens): number | null {
  const [bottom, top] = bottomAndTop(line);
  const floor = floorPointOf(bottom, fit, lens);
  if (!floor) return null;
  if (kind === 'width') {
    const other = floorPointOf(top, fit, lens);
    if (!other) return null;
    const distance = Math.hypot(floor[0] - other[0], floor[2] - other[2]);
    return distance > 1e-6 ? distance : null;
  }
  // 高さ: 下の端の真上（垂直な線）に、上の端の視線がいちばん近づくところの高さ
  const ray = toWorld(rayOf(top, lens), fit);
  const horizontal = ray[0] * ray[0] + ray[2] * ray[2];
  if (horizontal < 1e-12) return null;
  const s = (ray[0] * floor[0] + ray[2] * floor[2]) / horizontal;
  const height = s * ray[1] + 1; // 床は y = −1
  return s > 0 && height > 1e-6 ? height : null;
}

/** 線の実際の長さからカメラの高さ（m）。長さが無い・測れないときは null */
export function cameraHeightFor(line: ScaleLine | null, fit: FloorFit, lens: Lens): number | null {
  if (!line?.length) return null;
  const measured = lengthAtUnitHeight(line, resolveKind(line, fit, lens), fit, lens);
  if (!measured) return null;
  const height = line.length / measured;
  return Math.min(CAMERA_HEIGHT_LIMITS.max, Math.max(CAMERA_HEIGHT_LIMITS.min, height));
}

/** 最初に出す線。見えている範囲の下から 2 割の高さに、横幅の真ん中 4 割 */
export function defaultLine(region: VisibleRegion): ScaleLine {
  const y = region.y + region.height * 0.8;
  return {
    a: { x: region.x + region.width * 0.3, y },
    b: { x: region.x + region.width * 0.7, y },
    kind: 'auto',
    length: null,
  };
}

/** 保存した線を読み戻す。形が崩れていれば null */
export function normalizeScaleLine(value: unknown): ScaleLine | null {
  const line = value as Partial<ScaleLine> | null;
  const point = (p: unknown): p is PhotoPoint =>
    Boolean(p) && Number.isFinite((p as PhotoPoint).x) && Number.isFinite((p as PhotoPoint).y);
  if (!line || !point(line.a) || !point(line.b)) return null;
  const kind: ScaleKind = line.kind === 'width' || line.kind === 'height' ? line.kind : 'auto';
  const length = Number.isFinite(line.length) && (line.length as number) > 0 ? (line.length as number) : null;
  return { a: { x: line.a.x, y: line.a.y }, b: { x: line.b.x, y: line.b.y }, kind, length };
}
