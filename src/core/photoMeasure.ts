/**
 * 写真の中で測った長さから、家具の「見た目の大きさ」を決める。
 *
 * 床の上にある物の 1m が何ピクセルに写るかは、**画面の高さで決まる**。
 * 地平線に近いほど小さく、手前ほど大きい。カメラの数式に落とすと、
 *
 *   1m あたりの大きさ ＝（足元の y − 地平線の y）÷ カメラの高さ
 *
 * と、画面の y に対して直線的になる。画角も見下ろし角も式には出てこない
 * （すべて「地平線の y」1 つに吸収される）。
 *
 * 利用者が床の上の物を 1 つ測れば、その場所の「1m = どれだけ」が決まり、
 * カメラの高さを 1.4m と仮定して地平線が出せる。**手前と奥で 2 つ測れば仮定が消える**
 * （未知数 2 つに対して式が 2 本）。
 *
 * 座標はすべて「写真の中の割合」。横は縦横比を掛けて縦と同じ尺にそろえる。
 */

import { CAMERA_HEIGHT } from '@/core/floorFit';
import type { PhotoPoint } from '@/core/photoView';

/** 床の上にある物を、両端をタップして測ったもの */
export interface FloorMeasure {
  a: PhotoPoint;
  b: PhotoPoint;
  /** 実寸（m） */
  metres: number;
}

/** 測定から出した、この写真の遠近 */
export interface FloorScale {
  /** 地平線（目の高さ）の y。写真の中の割合。上端が 0 */
  horizonY: number;
  /** カメラの高さ（m） */
  cameraHeight: number;
  /** カメラの高さを仮定で置いたか。2 か所測れていれば false */
  assumed: boolean;
  /** 2 か所以上測ったのに答えが出ず、1 か所だけで出したか */
  inconsistent: boolean;
}

/** これより小さい 1m は認めない（地平線より上に置かれたときの逃げ） */
const MIN_PER_METRE = 0.005;

/**
 * カメラの高さとしてありえる範囲（m）。外れたら測り間違いとみなす。
 * 座って撮っても 0.4m、腕を伸ばしても 2.2m を超えることはまず無い
 */
const HEIGHT_LIMITS = { min: 0.4, max: 2.2 };

/** 測定 1 つを「足元の y」と「1m あたりの大きさ」に直す */
function toSample(measure: FloorMeasure, aspect: number): { y: number; perMetre: number } {
  const width = (measure.b.x - measure.a.x) * aspect;
  const height = measure.b.y - measure.a.y;
  return {
    y: (measure.a.y + measure.b.y) / 2,
    perMetre: Math.hypot(width, height) / measure.metres,
  };
}

/** 測定から遠近を出す。測定が無ければ null */
export function solveFloorScale(measures: FloorMeasure[], aspect: number): FloorScale | null {
  const samples = measures
    .filter((m) => m.metres > 0)
    .map((m) => toSample(m, aspect))
    .filter((s) => s.perMetre > 0);
  if (samples.length === 0) return null;

  // 手前（y が大きい）と奥（y が小さい）でいちばん離れた 2 つを使う。
  // 近い 2 つだと式がほぼ同じになり、答えがぶれる
  const near = samples.reduce((a, b) => (b.y > a.y ? b : a));
  const far = samples.reduce((a, b) => (b.y < a.y ? b : a));

  if (samples.length >= 2 && near !== far && near.perMetre !== far.perMetre) {
    const cameraHeight = (near.y - far.y) / (near.perMetre - far.perMetre);
    if (cameraHeight >= HEIGHT_LIMITS.min && cameraHeight <= HEIGHT_LIMITS.max) {
      return {
        horizonY: near.y - cameraHeight * near.perMetre,
        cameraHeight,
        assumed: false,
        inconsistent: false,
      };
    }
  }

  // 1 か所だけ、または 2 か所がかみ合わない。カメラの高さを仮定して出す
  return {
    horizonY: near.y - CAMERA_HEIGHT * near.perMetre,
    cameraHeight: CAMERA_HEIGHT,
    assumed: true,
    inconsistent: samples.length >= 2,
  };
}

/** 足元がその y にある物の、1m あたりの大きさ（写真の高さに対する割合） */
export function perMetreAt(scale: FloorScale, footY: number): number {
  return Math.max(MIN_PER_METRE, (footY - scale.horizonY) / scale.cameraHeight);
}
