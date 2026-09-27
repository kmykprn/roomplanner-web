/**
 * 写真モードの状態。
 *
 * 背景の写真と、その上に置いた家具を持つ。
 * **部屋モードとは家具の一覧を分けている。** 同じ配列を共有すると、
 * 写真に置いたソファが部屋にも現れてしまうため。
 *
 * 家具の出し入れは部屋モードと同じ処理なので `core/furnitureScene.ts` にある。
 */

import { createStore } from '@/core/store';
import {
  createFurnitureScene,
  type FurnitureSceneState,
} from '@/core/furnitureScene';
import { shrinkForDisplay } from '@/core/imageResize';
import { readFocal35, vfovFromFocal35 } from '@/core/exifFocal';
import { deleteBackground, deleteMask, saveBackground } from '@/platform/backgroundStore';
import {
  clampPhotoView,
  DEFAULT_PHOTO_VIEW,
  viewOrigin,
  visibleSize,
  type PhotoPoint,
  type PhotoView,
} from '@/core/photoView';
import { CAMERA_HEIGHT, DEFAULT_FLOOR_FIT, clampFloorFit, type FloorFit } from '@/core/floorFit';
import {
  cameraHeightFor,
  defaultLine,
  resolveKind,
  type Lens,
  type ScaleLine,
  type VisibleRegion,
} from '@/core/scaleLine';

/**
 * 背景写真の読み込み具合。
 *
 * **成否を状態として持つ。** 画面に出さないと、読み込めなかったときに
 * 「黒いまま」としか分からず、原因の切り分けができない。
 */
export type BackgroundStatus = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * 手前にある物を指定する道具。
 *
 *   brush   … なぞる。なぞった通りに塗る
 *   polygon … 囲む。角を順にタップして閉じると中が塗られる。机や棚のような直線の物向け
 *   eraser  … 消しゴム。なぞった場所の指定を消す
 */
export type MaskToolKind = 'brush' | 'polygon' | 'eraser';

export interface MaskTool {
  kind: MaskToolKind;
  /** 太い筆。広い面を手早く塗るためのもの（なぞる・消しゴムのときだけ効く） */
  thick: boolean;
}

/**
 * 写真の解析（画角と傾きを自動で出す）の様子。
 *
 *   idle    … まだ／写真が無い
 *   running … 解析中（数秒）
 *   done    … 出た。floorFit と vfovDeg に入っている
 *   failed  … 出せなかった。手で合わせてもらう
 */
export type CalibrationStatus = 'idle' | 'running' | 'done' | 'failed';

export interface PhotoState extends FurnitureSceneState {
  /** 背景写真の表示用 URL（Blob URL）。未選択なら null */
  backgroundUrl: string | null;
  /** 選んだ写真のファイル名。どれを開いているか分かるように画面に出す */
  backgroundName: string | null;
  backgroundStatus: BackgroundStatus;
  /** 背景写真の縦横比（幅 ÷ 高さ）。写真の矩形の中だけに描くために要る */
  backgroundAspect: number | null;

  /** 写真のどこを、どれだけ寄って見ているか。写真と 3D の両方がこれに従う */
  view: PhotoView;

  /** 写真の床に合わせたカメラの傾き（core/floorFit.ts）。写真ごとに持つ */
  floorFit: FloorFit;
  /** 写真から出した縦の画角（度）。無ければ既定の画角で描く */
  vfovDeg: number | null;
  /**
   * 写真の EXIF にあった 35mm 換算の焦点距離（mm）。無ければ null。
   * あれば画角はこれで決まり、写真の解析は傾きだけを出す（core/exifFocal.ts）
   */
  lensFocal35: number | null;
  calibration: CalibrationStatus;
  /**
   * 大きさを合わせる線（core/scaleLine.ts）。まだ出していなければ null で、
   * 合わせる姿に入ったときに見えている範囲の中に作る
   */
  scaleLine: ScaleLine | null;
  /** カメラの高さ（m）。線の長さを入れると決まる。写真の縮尺そのもの */
  cameraHeight: number;
  /** 大きさを合わせている最中か。この間だけ線を出し、指の動きを線の端に使う */
  isScaling: boolean;
  /** 表示する範囲を調整している最中か。この間は 1 本指で写真をずらす */
  isFramingPhoto: boolean;

  /**
   * 隠す場所（家具の手前にある物）のマスク画像の URL。無ければ null。
   *
   * 塗った形をそのまま画像で持つ。写真をこの形で切り抜いて 3D の上に重ねると、
   * その場所だけ写真が家具の手前に出る（3D 側は何も知らない）
   */
  maskUrl: string | null;
  /** 手前にある物を指定している最中か。この間は 1 本指が道具になる */
  isMasking: boolean;
  maskTool: MaskTool;
  /** 「囲む」で打っている途中の角。閉じると塗られて空になる */
  maskPolygon: PhotoPoint[];
  /** 「戻す」で戻れる回数。0 なら押せない */
  maskUndoDepth: number;
}

export const photoState = createStore<PhotoState>({
  backgroundUrl: null,
  backgroundName: null,
  backgroundStatus: 'idle',
  backgroundAspect: null,
  view: { ...DEFAULT_PHOTO_VIEW },
  floorFit: { ...DEFAULT_FLOOR_FIT },
  vfovDeg: null,
  lensFocal35: null,
  calibration: 'idle',
  scaleLine: null,
  cameraHeight: CAMERA_HEIGHT,
  isScaling: false,
  isFramingPhoto: false,
  maskUrl: null,
  isMasking: false,
  maskTool: { kind: 'brush', thick: false },
  maskPolygon: [],
  maskUndoDepth: 0,
  furniture: [],
  selectedId: null,
});

/**
 * 新しい家具を置く床の位置を、いまのカメラから決める関数。main.ts が入れる。
 *
 * 位置を決め打ちにしない理由: 写真の画角と傾きは写真ごとに違うので、
 * 同じ座標でも「画面のどこに、どの大きさで出るか」が写真ごとに変わる。
 * 広角の写真では 4 m 先が画面の真ん中に小さく出ていた
 */
let placementFromCamera: (() => [number, number, number] | null) | null = null;

export function setPhotoPlacement(resolve: () => [number, number, number] | null): void {
  placementFromCamera = resolve;
}

/** カメラで決められないとき（床より上を向いているなど）の置き場。カメラの 2 m 先 */
const FALLBACK_PLACEMENT: [number, number, number] = [0, 0, 2];

/** 写真モードの置き場。UI とドラッグ操作はこの形で受け取る */
export const photoScene = createFurnitureScene(photoState, {
  // 画面の下寄りに見えている床に置く。空きを探して端に置くと画面の外に出て見失う。
  // 重なっても、置いた直後は選択されているので動かせばよい
  placementFor: () => placementFromCamera?.() ?? FALLBACK_PLACEMENT,

  // 写真に壁は無いので丸めない。画面の外まで動かせてよい
  constrain: (position) => position,
});

/**
 * 背景の写真を差し替える。
 *
 * **表示できることを確かめてから差し替える。** URL を作った時点では、その画像を
 * ブラウザが描けるかどうかは分からない（対応していない形式、壊れたファイル、
 * 端末の上限を超える大きさ）。確かめずに背景へ入れると、黙って黒いままになる。
 */
export async function setBackground(file: File): Promise<void> {
  photoState.set({ backgroundStatus: 'loading', backgroundName: file.name });

  // 縮めると EXIF が消えるので、先に元のファイルからレンズの焦点距離を読んでおく
  const lensFocal35 = await readFocal35(file);

  let shrunk: Blob;
  try {
    // 原寸のままだと Safari が描かないことがあるので、表示用に縮めてから渡す
    shrunk = await shrinkForDisplay(file);
  } catch {
    photoState.set({ backgroundStatus: 'failed' });
    return;
  }

  // 焦点距離は写真が出る**前に**入れる。写真が出た瞬間に解析が始まる（main.ts）ので、
  // あとから入れると解析が画角を知らないまま走る
  // 解析の様子も「まだ」に戻しておく。写真が出た瞬間に、この写真の解析が始まる
  const previous = { lensFocal35: photoState.get().lensFocal35, calibration: photoState.get().calibration };
  photoState.set({ lensFocal35, calibration: 'idle' });
  if (!(await showBackground(shrunk))) {
    photoState.set(previous); // 出せなかったら前の写真のまま
    return;
  }

  // 前の写真の画角と大きさの合わせ方は、別の写真では意味がないので捨てる。
  // ここで捨てる（showBackground では捨てない）のは、起動時の読み戻しでも
  // showBackground を通るため。同じ写真の読み戻しで捨てると、開くたびに解析し直す。
  // EXIF に焦点距離があれば、画角は解析を待たずにここで決まる
  const aspect = photoState.get().backgroundAspect;
  photoState.set({
    vfovDeg: lensFocal35 && aspect ? vfovFromFocal35(lensFocal35, aspect) : null,
    ...FRESH_SCALE,
  });

  // 次に開いたときも残っているように、縮めた1枚を端末に置く。
  // 置けなくても（容量・プライベートモード）いま見えているものは変わらない
  saveBackground(shrunk).catch(() => {});

  // 前の写真で寄ったままだと、新しい写真がいきなり拡大された状態で出る。
  // 隠す場所も前の写真のものなので消す
  photoState.set({ view: { ...DEFAULT_PHOTO_VIEW } });
  clearMask();
  // 選んだ直後に、表示する範囲を決めてもらう
  setFramingPhoto(true);
}

/**
 * 写真を画面に出す。選んだ直後と、起動時に読み戻したときの両方から呼ぶ。
 * 読めなければ「失敗」にして false を返す
 */
export async function showBackground(blob: Blob): Promise<boolean> {
  const url = URL.createObjectURL(blob);
  let aspect: number;
  try {
    const image = await decodeImage(url);
    aspect = image.naturalWidth / image.naturalHeight;
  } catch {
    URL.revokeObjectURL(url);
    photoState.set({ backgroundStatus: 'failed' });
    return false;
  }

  replaceBackgroundUrl(url);
  photoState.set({ backgroundStatus: 'ready', backgroundAspect: aspect });
  return true;
}

/** 背景の写真を外す */
export function clearBackground(): void {
  replaceBackgroundUrl(null);
  photoState.set({
    backgroundName: null,
    backgroundStatus: 'idle',
    backgroundAspect: null,
    // 写真に付いていた解析結果と大きさの合わせ方も一緒に捨てる
    vfovDeg: null,
    lensFocal35: null,
    calibration: 'idle',
    ...FRESH_SCALE,
  });
  // 端末に残した1枚も捨てる。次に開いたときに戻ってこないように
  deleteBackground().catch(() => {});
  clearMask();
}

/** 隠す場所を塗っている最中かを切り替える */
export function setMasking(isMasking: boolean): void {
  if (photoState.get().isMasking !== isMasking) photoState.set({ isMasking });
}

/** 表示する範囲を調整する姿に入る・出る */
export function setFramingPhoto(isFramingPhoto: boolean): void {
  if (photoState.get().isFramingPhoto !== isFramingPhoto) photoState.set({ isFramingPhoto });
}

/**
 * 写真の画角を返す関数。main.ts が入れる（描いているカメラが持っている）。
 * 線からカメラの高さを出すのに要る
 */
let lensSource: (() => Lens) | null = null;

export function setLensSource(source: () => Lens): void {
  lensSource = source;
}

/** 大きさの合わせ方を、写真ごとの初期状態に戻す。新しい写真を選んだとき・外したとき */
const FRESH_SCALE = {
  scaleLine: null,
  cameraHeight: CAMERA_HEIGHT,
};

/** 寸法を合わせる姿に入る・出る。入ったとき、線がまだ無ければ見えている範囲の中に作る */
export function setScaling(isScaling: boolean): void {
  const { scaleLine } = photoState.get();
  if (photoState.get().isScaling === isScaling) return;
  photoState.set({ isScaling, ...(isScaling && !scaleLine ? { scaleLine: defaultLine(visibleRegion()) } : {}) });
}

/** 線の端・読み方・長さのどれかを変える。カメラの高さは refreshCameraHeight が解き直す */
export function updateScaleLine(patch: Partial<ScaleLine>): void {
  const line = photoState.get().scaleLine;
  if (!line) return;
  photoState.set({ scaleLine: { ...line, ...patch } });
  refreshCameraHeight();
}

/** 大きさの合わせ方を捨てて、立って撮った高さに戻す。線は元の位置に置き直す */
export function resetScale(): void {
  photoState.set({ scaleLine: defaultLine(visibleRegion()), cameraHeight: CAMERA_HEIGHT });
}

/**
 * 線と、いまの傾き・画角から、カメラの高さを解き直す。
 *
 * 線の長さを入れたときだけでなく、写真の解析で傾きや画角が変わったときにも要る
 * （同じ線でも、傾きが変われば床の上での長さが変わる）。main.ts が状態の変化ごとに呼ぶ。
 * 変わっていなければ何もしない（呼び返しが止まるように）
 */
export function refreshCameraHeight(): void {
  if (!lensSource) return;
  const { scaleLine, floorFit, cameraHeight } = photoState.get();
  const next = cameraHeightFor(scaleLine, floorFit, lensSource()) ?? CAMERA_HEIGHT;
  if (Math.abs(next - cameraHeight) > 1e-6) photoState.set({ cameraHeight: next });
}

/** いまの線を幅と高さのどちらで読んでいるか（auto のときは線の向きで決めた方） */
export function currentScaleKind(): 'width' | 'height' {
  const { scaleLine, floorFit } = photoState.get();
  if (!scaleLine || !lensSource) return 'width';
  return resolveKind(scaleLine, floorFit, lensSource());
}

/** 長さを入れたのに測れない（端が床に届いていない など）か */
export function scaleUnmeasurable(): boolean {
  const { scaleLine, floorFit } = photoState.get();
  if (!scaleLine?.length || !lensSource) return false;
  return cameraHeightFor(scaleLine, floorFit, lensSource()) === null;
}

/** 写真のうち、いま画面に見えている範囲 */
function visibleRegion(): VisibleRegion {
  const view = clampPhotoView(photoState.get().view);
  const origin = viewOrigin(view);
  const size = visibleSize(view);
  // 縮めて写真全体が入っているときは、写真の外（余白）には置かない
  const x = Math.max(0, origin.x);
  const y = Math.max(0, origin.y);
  return { x, y, width: Math.min(1, origin.x + size.width) - x, height: Math.min(1, origin.y + size.height) - y };
}

/** 写真の解析の進み具合を入れる */
export function setCalibration(calibration: CalibrationStatus): void {
  if (photoState.get().calibration !== calibration) photoState.set({ calibration });
}

/** 解析をもう一度やらせる（できなかったとき） */
export function retryCalibration(): void {
  photoState.set({ calibration: 'idle' });
}

/** 解析で出た画角と傾きを入れる */
export function applyCalibration(vfovDeg: number, fit: FloorFit): void {
  // カメラの高さは、傾きと画角が変わったあとに main.ts が refreshCameraHeight で解き直す
  photoState.set({ vfovDeg, floorFit: clampFloorFit(fit), calibration: 'done' });
}

export function setMaskTool(patch: Partial<MaskTool>): void {
  photoState.set({ maskTool: { ...photoState.get().maskTool, ...patch } });
}

export function setMaskPolygon(maskPolygon: PhotoPoint[]): void {
  photoState.set({ maskPolygon });
}

export function setMaskUndoDepth(maskUndoDepth: number): void {
  if (photoState.get().maskUndoDepth !== maskUndoDepth) photoState.set({ maskUndoDepth });
}

/**
 * マスク画像を差し替える。塗るたび（core/maskEditor.ts）と、起動時に読み戻したときに呼ぶ。
 *
 * **前の URL はここでは解放しない。** 表示側（main.ts）が新しい画像を読み込んでから
 * 差し替えるので、その間は前の画像がまだ画面に出ている。解放は差し替えたあとに向こうでやる
 */
export function setMaskUrl(url: string | null): void {
  photoState.set({ maskUrl: url });
}

/** 隠す場所をすべて消す。端末に残した分も捨てる */
export function clearMask(): void {
  setMaskUrl(null);
  deleteMask().catch(() => {});
}

/**
 * 見ている場所を変える。**丸めはここ1箇所に置く。**
 *
 * ピンチ（`interaction/photoZoom.ts`）から呼ばれる。写真からはみ出す値が来ても、
 * ここで枠の中へ戻してから入れる
 */
export function setPhotoView(view: PhotoView): void {
  photoState.set({ view: clampPhotoView(view) });
}

/**
 * 背景の URL を差し替え、前の URL を解放する。
 *
 * **解放しないと、選び直すたびに写真1枚ぶん（数MB）がメモリに居座り続ける。**
 * Blob URL はドキュメントが生きている限り元のデータを固定するため。
 */
function replaceBackgroundUrl(url: string | null): void {
  const previous = photoState.get().backgroundUrl;
  if (previous) URL.revokeObjectURL(previous);
  photoState.set({ backgroundUrl: url });
}

/** 実際に画像として読めるところまで確かめる。読めなければ例外になる */
function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('写真として読み込めませんでした'));
    image.src = url;
  });
}
