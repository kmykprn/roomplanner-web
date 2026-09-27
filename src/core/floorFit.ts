/**
 * 写真の床に合わせるための「カメラの傾き」。
 *
 * 写真モードは、写真の上に 3D の家具を置く。そのとき 3D 側のカメラが
 * **写真を撮ったときのカメラと同じ向き**になっていないと、家具が床から浮いたり、
 * 奥に動かしたときの縮み方が写真と合わなかったりする。
 *
 * 合わせるのは 2 つだけ。
 *
 *   前後（ピッチ）… どれくらい見下ろしているか。奥行きの詰まり方に効く
 *   左右（ロール）… 水平がどれくらい傾いているか
 *
 * **床の上での向き（ヨー）は合わせない。** 床の平面は回しても変わらないので、
 * 家具が床に乗るかどうかには関係しないため。置いた家具の向きは利用者が別に決める。
 *
 * 傾きは写真から自動で出す（core/photoCalib.ts）。手で合わせる手段は置かない。
 * 高さ（カメラから床まで）は 1.4 m（立って撮った前提）に決めている。寸法の画面で「室内の寸法を計算」を
 * 押したあとは、家具を写真の奥行きに合わせて置くので（core/depthPlacement.ts）、この高さは効かない。
 */

/** 床の傾き。単位は度 */
export interface FloorFit {
  /** 見下ろし角。0 が水平、正が見下ろし */
  pitchDeg: number;
  /** 左右の傾き。正で右下がり */
  rollDeg: number;
}

/**
 * 既定値。立って部屋を撮ると、たいてい少し見下ろしている。
 * 手で合わせるときの出発点なので、ありそうな真ん中あたりに置く
 */
export const DEFAULT_FLOOR_FIT: FloorFit = { pitchDeg: 10, rollDeg: 0 };

/** カメラから床までの高さ（m）。立って撮った前提。室内の寸法を計算するまでは、この高さの床に家具を置く */
export const CAMERA_HEIGHT = 1.4;

/**
 * 動かせる範囲。人が部屋を撮るとき、真下を向いたり大きく傾けたりはしない。
 * 範囲を切っておくと、指が滑っても戻せなくならない
 */
export const FLOOR_FIT_LIMITS = { pitch: { min: -10, max: 45 }, roll: { min: -25, max: 25 } };

export function clampFloorFit(fit: FloorFit): FloorFit {
  return {
    pitchDeg: clamp(fit.pitchDeg, FLOOR_FIT_LIMITS.pitch.min, FLOOR_FIT_LIMITS.pitch.max),
    rollDeg: clamp(fit.rollDeg, FLOOR_FIT_LIMITS.roll.min, FLOOR_FIT_LIMITS.roll.max),
  };
}

/** 壊れた値が保存されていても起動できるように、数でなければ既定に戻す */
export function normalizeFloorFit(value: unknown): FloorFit {
  const fit = value as Partial<FloorFit> | null;
  if (!fit || !Number.isFinite(fit.pitchDeg) || !Number.isFinite(fit.rollDeg)) {
    return { ...DEFAULT_FLOOR_FIT };
  }
  return clampFloorFit({ pitchDeg: fit.pitchDeg as number, rollDeg: fit.rollDeg as number });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
