/**
 * 写真の見ている場所。
 *
 * 写真と 3D は**同じ矩形を切り取って**出す。写真は CSS の背景を引き伸ばし、
 * 3D は `camera.setViewOffset()` で視錐台を切り取るので、寄っても 3D は
 * 解像度いっぱいのまま描かれる。
 *
 * 座標は「写真の中の割合」。左上が (0, 0)、右下が (1, 1)。
 * 画面の大きさに依らないので、画面が回っても見ている場所は変わらない。
 */

export interface PhotoView {
  /** 倍率。1 で写真の全体が見えている */
  scale: number;
  /** 見ている場所の中心（写真の中の割合） */
  centerX: number;
  centerY: number;
}

export const DEFAULT_PHOTO_VIEW: PhotoView = { scale: 1, centerX: 0.5, centerY: 0.5 };

/**
 * 倍率の範囲。
 *
 * 下限が 1 なのは、写真より引くと枠に隙間ができるため。
 * 上限の 4 倍は、手元のスマホの写真だと画素が見え始めるあたり
 */
const SCALE_LIMITS = { min: 1, max: 4 };

/** 画面の中の位置。左上が (0, 0)、右下が (1, 1) */
export interface ScreenPoint {
  u: number;
  v: number;
}

/** 倍率を範囲に収める */
export function clampScale(scale: number): number {
  return Math.min(SCALE_LIMITS.max, Math.max(SCALE_LIMITS.min, scale));
}

/**
 * 見ている場所を、写真からはみ出さないところまで戻す。
 *
 * **はみ出させると枠に隙間ができ、そこだけ 3D が写真の無い場所に描かれる。**
 * 見えている幅は 1/倍率 なので、中心が動ける範囲はその半分だけ内側になる
 */
export function clampPhotoView(view: PhotoView): PhotoView {
  const scale = clampScale(view.scale);
  const half = 1 / (2 * scale);
  return {
    scale,
    centerX: clamp(view.centerX, half, 1 - half),
    centerY: clamp(view.centerY, half, 1 - half),
  };
}

/** 見えている矩形の左上（写真の中の割合） */
export function viewOrigin(view: PhotoView): { x: number; y: number } {
  const half = 1 / (2 * view.scale);
  return { x: view.centerX - half, y: view.centerY - half };
}

/** 画面のこの位置に、写真のどこが写っているか */
export function photoPointAt(view: PhotoView, point: ScreenPoint): { x: number; y: number } {
  return {
    x: view.centerX + (point.u - 0.5) / view.scale,
    y: view.centerY + (point.v - 0.5) / view.scale,
  };
}

/**
 * 写真のこの点が画面のこの位置に来るような、見ている場所を出す。
 *
 * ピンチで寄るときに使う。**指で挟んだところが指の下から逃げない**ようにするため、
 * 倍率を変える前後で同じ点が同じ位置に来る中心を求めている
 */
export function viewAnchoredAt(
  scale: number,
  photoPoint: { x: number; y: number },
  point: ScreenPoint
): PhotoView {
  return clampPhotoView({
    scale,
    centerX: photoPoint.x - (point.u - 0.5) / scale,
    centerY: photoPoint.y - (point.v - 0.5) / scale,
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
