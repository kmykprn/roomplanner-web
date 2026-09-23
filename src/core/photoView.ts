/**
 * 写真の見ている場所。
 *
 * 写真と 3D は**同じ矩形を切り取って**出す。写真は CSS の背景を引き伸ばし、
 * 3D は `camera.setViewOffset()` で視錐台を切り取るので、寄っても 3D は
 * 解像度いっぱいのまま描かれる。
 *
 * 座標は「写真の中の割合」。左上が (0, 0)、右下が (1, 1)。
 * 画面の大きさに依らないので、画面が回っても見ている場所は変わらない。
 *
 * **写真は画面いっぱいに敷く。** 縦横比が画面と違う分は、はみ出させて切り落とす
 * （引き伸ばさないので比率は崩れない）。倍率 1 でも、写真の縦か横の一部だけが見えている。
 * どれだけ見えているかは画面の大きさで決まるので、viewer が setPhotoFrame で入れる。
 */

/**
 * 倍率 1 のとき、写真の幅と高さのどれだけが画面に入っているか（0〜1）。
 * 画面より横長の写真なら横が 1 未満、縦長なら縦が 1 未満。部屋モードや写真が無いときは 1
 */
let frame = { x: 1, y: 1 };

export function setPhotoFrame(x: number, y: number): void {
  frame = { x, y };
}

/** この見方で、写真の幅と高さのどれだけが見えているか */
export function visibleSize(view: PhotoView): { width: number; height: number } {
  return { width: frame.x / view.scale, height: frame.y / view.scale };
}

export interface PhotoView {
  /** 倍率。1 で写真の全体が見えている */
  scale: number;
  /** 見ている場所の中心（写真の中の割合） */
  centerX: number;
  centerY: number;
}

/**
 * 最初の見え方。**下に寄せる。** 写真は画面を覆うように敷くので上下が切れることがあるが、
 * 家具を置く床は写真の下のほうにある。切るなら天井の側にする（中心は写真の中に収め直される）
 */
export const DEFAULT_PHOTO_VIEW: PhotoView = { scale: 1, centerX: 0.5, centerY: 1 };

/**
 * 倍率の上限。4 倍は、手元のスマホの写真だと画素が見え始めるあたり。
 *
 * 下限は画面の形で変わる（minScale）。倍率 1 が「画面いっぱい」（はみ出た分は切り落とす）で、
 * そこから写真全体が入るところまで縮められる（その分は余白になる）
 */
const MAX_SCALE = 4;

/** 倍率の下限。写真全体が画面に入る倍率 */
export function minScale(): number {
  return Math.min(1, frame.x, frame.y);
}

/** 画面の中の位置。左上が (0, 0)、右下が (1, 1) */
export interface ScreenPoint {
  u: number;
  v: number;
}

/** 倍率を範囲に収める */
export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(minScale(), scale));
}

/** 倍率の上限（バーの右端に使う） */
export function maxScale(): number {
  return MAX_SCALE;
}

/**
 * 見ている場所を、写真からはみ出さないところまで戻す。
 *
 * **はみ出させると枠に隙間ができ、そこだけ 3D が写真の無い場所に描かれる。**
 * 中心が動ける範囲は、見えている幅の半分だけ内側になる。
 * 縮めて写真全体が入っている向きは、真ん中に置く（余白を両側に均等に出す）
 */
export function clampPhotoView(view: PhotoView): PhotoView {
  const scale = clampScale(view.scale);
  const { width, height } = visibleSize({ ...view, scale });
  return {
    scale,
    centerX: width >= 1 ? 0.5 : clamp(view.centerX, width / 2, 1 - width / 2),
    centerY: height >= 1 ? 0.5 : clamp(view.centerY, height / 2, 1 - height / 2),
  };
}

/** 見えている矩形の左上（写真の中の割合） */
export function viewOrigin(view: PhotoView): { x: number; y: number } {
  const { centerX, centerY, scale } = clampPhotoView(view);
  const { width, height } = visibleSize({ scale, centerX, centerY });
  return { x: centerX - width / 2, y: centerY - height / 2 };
}

/** 写真の中の位置（割合）。左上が (0, 0)、右下が (1, 1) */
export interface PhotoPoint {
  x: number;
  y: number;
}

/** 画面のこの位置に、写真のどこが写っているか */
export function photoPointAt(view: PhotoView, point: ScreenPoint): PhotoPoint {
  // 保存されている見え方は、画面の大きさが変わると写真からはみ出していることがある。
  // 描く側（viewer）と同じく、収め直してから使う
  const { x, y } = viewOrigin(view);
  const { width, height } = visibleSize(view);
  return { x: x + point.u * width, y: y + point.v * height };
}

/** 写真のこの点が、画面のどこに写っているか。photoPointAt の逆 */
export function screenPointOf(view: PhotoView, point: PhotoPoint): ScreenPoint {
  const { x, y } = viewOrigin(view);
  const { width, height } = visibleSize(view);
  return { u: (point.x - x) / width, v: (point.y - y) / height };
}

/**
 * 写真のこの点が画面のこの位置に来るような、見ている場所を出す。
 *
 * ピンチで寄るときに使う。**指で挟んだところが指の下から逃げない**ようにするため、
 * 倍率を変える前後で同じ点が同じ位置に来る中心を求めている
 */
export function viewAnchoredAt(
  scale: number,
  photoPoint: PhotoPoint,
  point: ScreenPoint
): PhotoView {
  const { width, height } = visibleSize({ scale, centerX: 0, centerY: 0 });
  return clampPhotoView({
    scale,
    centerX: photoPoint.x - (point.u - 0.5) * width,
    centerY: photoPoint.y - (point.v - 0.5) * height,
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
