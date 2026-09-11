/**
 * 写真の中の床の見え方。
 *
 * 「写真がどんなカメラで撮られたか」を割り出すのをやめ、**床（方眼）を直接動かして
 * 写真に合わせる**形にした。使う人が触るのは次の4つだけで、どれも見れば分かるものにしてある。
 *
 *   傾き … 床の寝かせ具合。奥が持ち上がる／寝る
 *   向き … マス目の向き。フローリングの向きに合わせる
 *   高さ … マス目の大きさ。撮った人の目の高さでもある
 *   水平 … 写真が傾いているときに直す
 *
 * ## 画角を出していない理由
 *
 * 画角（＝奥に行くほど縮む速さ）は撮影者の語彙で、使う人には伝わらない。
 * 既定値に固定してある。**本当の画角とずれていると「手前を合わせると奥がずれる」**
 * という形で出るが、どれくらい困るかは写真によるので、まず出さずに様子を見る。
 * 必要になったら「奥のずれ」という名前で1つ足せばよい（値はここに足すだけで済む）。
 */

export interface FloorView {
  /** 見下ろす角度（度）。大きいほど真上から見た形に近づく */
  pitch: number;
  /** 床の向き（度） */
  yaw: number;
  /** 撮った人の目の高さ（m）。マス目の大きさに効く */
  height: number;
  /** 写真の傾き（度）。水平が出ていない写真を直す */
  roll: number;
}

/** 方眼1マスの大きさ（メートル）。既知の物（ドア幅80cm・畳）と比べやすい大きさ */
export const CELL_METERS = 0.5;

/** 固定してある画角（度）。使う人には出さない（上のコメント参照） */
export const FIXED_FOV = 50;

/**
 * 初期値。立って部屋を撮ったときに近いあたりから始める。
 * ここから動かす前提なので、正確である必要はない
 */
export const DEFAULT_FLOOR_VIEW: FloorView = {
  pitch: 15,
  yaw: 0,
  height: 1.5,
  roll: 0,
};

/**
 * 動かせる範囲。
 *
 * 傾きが 0 に近いと床が真横から見た形になり、地平線が画面の外へ飛んで操作できなくなる。
 * 高さも 0 に近づくとマス目が無限に大きくなるので、どちらも手前で止める
 */
const LIMITS = {
  pitch: { min: 3, max: 85 },
  height: { min: 0.3, max: 5 },
  roll: { min: -25, max: 25 },
};

/** ボタン1回ぶんの変化量。指で動かすより細かく詰められるようにする */
export const STEPS = {
  pitch: 1,
  yaw: 1,
  roll: 0.5,
  /** 高さは掛け算で動かす。低いときも高いときも同じ手応えになる */
  heightRatio: 1.05,
};

/** 範囲に収める。向きは一周させる */
export function clampFloorView(view: FloorView): FloorView {
  return {
    pitch: clamp(view.pitch, LIMITS.pitch),
    yaw: ((view.yaw % 360) + 360) % 360,
    height: clamp(view.height, LIMITS.height),
    roll: clamp(view.roll, LIMITS.roll),
  };
}

/**
 * 画面の中央がぶつかる床の位置。
 *
 * カメラは原点の真上にあるので、原点に物を置くと足元（画面の外）に出てしまう。
 * 新しい家具と方眼は、**いま見ている場所**に出す必要がある。
 *
 * 中央へ向かう光線は、俯角 θ だけ下を向いている。高さ h から床まで下りる間に
 * 水平方向へ h / tan(θ) だけ進むので、向き分を回して足す。
 */
export function floorPointUnderCenter(view: FloorView): [number, number, number] {
  const pitch = (view.pitch * Math.PI) / 180;
  const yaw = (view.yaw * Math.PI) / 180;
  const distance = view.height / Math.tan(pitch);

  return [-Math.sin(yaw) * distance, 0, -Math.cos(yaw) * distance];
}

function clamp(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, value));
}
