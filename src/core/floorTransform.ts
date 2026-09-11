/**
 * 写真の中の床の置き方。
 *
 * ## 考え方を裏返してある
 *
 * 「カメラを動かして床に合わせる」のをやめ、**床そのものを3Dの物体として置く**。
 * カメラは正面を向いたまま動かさず、床（方眼）と、その上に置いた家具を
 * まとめて1つのグループに入れて、そのグループを動かす。
 *
 * こうすると操作が `TransformControls`（three.js 同梱のギズモ）にそのまま乗り、
 * **矢印をつかんで動かす・リングをつかんで回す**という形になる。
 *
 * とくに「床を上下に動かしたい」は、カメラを動かす作り方では表せなかった
 * （床を上下させることと、カメラの高さを変えること＝縮尺が、区別できないため）。
 * 床を動かす作りにすると、**上向きの矢印がそのまま「上下」になる。**
 *
 * 家具はグループの中に入るので、「床は y = 0、家具は底面基準」という
 * これまでの決まりはそのまま使える。
 */

/** 操作の種類。ギズモの見た目もこれで変わる */
export type GizmoMode = 'translate' | 'rotate' | 'scale';

export interface FloorTransform {
  /** 置き場所（メートル）。カメラは原点にあり、-Z の方向を向いている */
  position: [number, number, number];
  /** 傾き（度）。X＝寝かせ具合、Y＝向き、Z＝水平 */
  rotation: [number, number, number];
  /** 1メートルの見かけの大きさ。家具も一緒に拡大される（＝縮尺） */
  scale: number;
}

/** 方眼1マスの大きさ（メートル）。既知の物（ドア幅80cm・畳）と比べやすい大きさ */
export const CELL_METERS = 0.5;

/** カメラの画角（度）。使う人には出さない */
export const FIXED_FOV = 50;

/**
 * 初期値。立って部屋を撮ったときに近いあたりから始める。
 *
 * カメラから見て 1.4m 下、4m 先に床を置く。ここから動かす前提なので、
 * 正確である必要はない
 */
export const DEFAULT_FLOOR_TRANSFORM: FloorTransform = {
  position: [0, -1.4, -4],
  rotation: [0, 0, 0],
  scale: 1,
};

/** 動かせる範囲。行き過ぎて戻れなくならないように止める */
const LIMITS = {
  position: { min: -30, max: 30 },
  scale: { min: 0.2, max: 5 },
};

/** ボタン1回ぶんの変化量 */
export const STEPS = {
  position: 0.2,
  rotation: 1,
  /** 大きさは掛け算で動かす。小さいときも大きいときも同じ手応えになる */
  scaleRatio: 1.1,
};

/** 範囲に収める。回しすぎた角度は -180〜180 に畳む */
export function clampFloorTransform(transform: FloorTransform): FloorTransform {
  return {
    position: transform.position.map((value) => clamp(value, LIMITS.position)) as [
      number,
      number,
      number,
    ],
    rotation: transform.rotation.map(wrapAngle) as [number, number, number],
    scale: clamp(transform.scale, LIMITS.scale),
  };
}

function clamp(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, value));
}

/** -180〜180 に畳む。何周も回したときに数字が読めなくなるのを防ぐ */
function wrapAngle(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}
