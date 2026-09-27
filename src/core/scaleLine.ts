/**
 * 寸法を合わせる線（寸法の画面のオレンジの線）。
 *
 * 利用者は、長さの分かっている物に線を合わせ、その実際の長さを入れる。線は最大 5 本まで引け、
 * 寸法の画面の「保存」で、写真の奥行きの倍率を線の長さに合わせる（core/depthPlacement.ts）。
 * 線は床に着いていなくてよい（壁のエアコンの幅でもよい）。本数を増やすほど合わせ方が正確になる
 * （DIODE で長さの誤差の中央値が 1 本 8%・2 本 4.5%・5 本 3%。5 本より増やしてもほぼ変わらない）。
 */

import type { PhotoPoint } from '@/core/photoView';

export interface ScaleLine {
  /** 両端（写真の中の割合） */
  a: PhotoPoint;
  b: PhotoPoint;
  /** 実際の長さ（m）。入れていなければ null */
  length: number | null;
}

/** 引ける線の本数の上限 */
export const MAX_SCALE_LINES = 5;

/** 写真のうち画面に見えている範囲（写真の中の割合）。線はこの中に出す */
export interface VisibleRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 新しく出す線。見えている範囲の横幅の真ん中 4 割に置く。
 * 1 本目は下から 2 割の高さ、2 本目からは 1 割ずつ上へずらす（前の線と重ならないように）
 */
export function defaultLine(region: VisibleRegion, index = 0): ScaleLine {
  const y = region.y + region.height * (0.8 - 0.1 * index);
  return {
    a: { x: region.x + region.width * 0.3, y },
    b: { x: region.x + region.width * 0.7, y },
    length: null,
  };
}

/** 長さの入った線だけ */
export function measuredLines(lines: ScaleLine[]): (ScaleLine & { length: number })[] {
  return lines.filter((line): line is ScaleLine & { length: number } => line.length !== null);
}

/** 保存した線を読み戻す。形が崩れていれば null */
export function normalizeScaleLine(value: unknown): ScaleLine | null {
  const line = value as Partial<ScaleLine> | null;
  const point = (p: unknown): p is PhotoPoint =>
    Boolean(p) && Number.isFinite((p as PhotoPoint).x) && Number.isFinite((p as PhotoPoint).y);
  if (!line || !point(line.a) || !point(line.b)) return null;
  const length = Number.isFinite(line.length) && (line.length as number) > 0 ? (line.length as number) : null;
  return { a: { x: line.a.x, y: line.a.y }, b: { x: line.b.x, y: line.b.y }, length };
}

/** 保存した線の一覧を読み戻す。崩れた線は捨て、上限を超えた分も捨てる */
export function normalizeScaleLines(value: unknown): ScaleLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeScaleLine)
    .filter((line): line is ScaleLine => line !== null)
    .slice(0, MAX_SCALE_LINES);
}
