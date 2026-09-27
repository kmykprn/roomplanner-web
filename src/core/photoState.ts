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
import { deleteBackground, deleteDepth, deleteMask, saveBackground, saveDepth } from '@/platform/backgroundStore';
import type { DownloadProgress } from '@/core/onnxModel';
import type { DepthMap } from '@/core/depthModel';
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
 * 室内の寸法の計算（寸法の画面の「室内の寸法を計算」）で、いまやっていること。
 *
 *   download  … 計算に使うデータ（モデル）を落としている。初回だけ
 *   calibrate … 写真の傾きと画角を出している（core/photoCalibModel.ts）
 *   depth     … 写真の奥行きを出している（core/depthModel.ts）
 */
export type MeasureStep = 'download' | 'calibrate' | 'depth';

/**
 * 室内の寸法の計算の様子。
 *
 *   idle    … まだ計算していない
 *   running … 計算中。始めた時刻から経過秒数を出す
 *   done    … 計算した。seconds はかかった秒数（端末から読み戻したときは無い）
 *   failed  … 計算できなかった。もう一度ボタンを押してもらう
 */
export type MeasureState =
  | { status: 'idle' }
  | { status: 'running'; step: MeasureStep; startedAt: number; download: DownloadProgress | null }
  | { status: 'done'; seconds: number | null }
  | { status: 'failed' };

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
  /** 室内の寸法の計算の様子 */
  measure: MeasureState;
  /** 計算した写真の奥行き。まだ計算していなければ null */
  depthMap: DepthMap | null;
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
  measure: { status: 'idle' },
  depthMap: null,
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

  if (!(await showBackground(shrunk))) return; // 出せなかったら前の写真のまま

  // 前の写真の画角・傾き・寸法の計算は、別の写真では意味がないので捨てる。
  // ここで捨てる（showBackground では捨てない）のは、起動時の読み戻しでも
  // showBackground を通るため。同じ写真の読み戻しで捨てると、開くたびに計算し直しになる。
  // EXIF に焦点距離があれば、画角は計算を待たずにここで決まる
  const aspect = photoState.get().backgroundAspect;
  photoState.set({
    lensFocal35,
    vfovDeg: lensFocal35 && aspect ? vfovFromFocal35(lensFocal35, aspect) : null,
    floorFit: { ...DEFAULT_FLOOR_FIT },
    ...FRESH_SCALE,
    ...FRESH_MEASURE,
  });
  deleteDepth().catch(() => {});

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
    // 写真に付いていた計算の結果と大きさの合わせ方も一緒に捨てる
    vfovDeg: null,
    lensFocal35: null,
    floorFit: { ...DEFAULT_FLOOR_FIT },
    ...FRESH_SCALE,
    ...FRESH_MEASURE,
  });
  // 端末に残した1枚も捨てる。次に開いたときに戻ってこないように
  deleteBackground().catch(() => {});
  deleteDepth().catch(() => {});
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

/** 室内の寸法の計算を、写真ごとの初期状態に戻す。新しい写真を選んだとき・外したとき */
const FRESH_MEASURE: Pick<PhotoState, 'measure' | 'depthMap'> = {
  measure: { status: 'idle' },
  depthMap: null,
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

/** 線を丸ごと入れ替える（寸法の画面の「戻る」で、入ったときの線に戻すため） */
export function setScaleLine(scaleLine: ScaleLine | null): void {
  photoState.set({ scaleLine });
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

/** 進み具合の知らせを間引く間隔（ms）。データを落とす間は細かく届くので、毎回は画面を書き換えない */
const PROGRESS_INTERVAL_MS = 100;

/**
 * 室内の寸法を計算する（寸法の画面の「室内の寸法を計算」）。
 *
 * 写真の傾きと画角（GeoCalib）と、写真の奥行き（MoGe-2）をまとめて出す。
 * 奥行きは画角が分かっている前提で出すので、傾きと画角が先。
 * 計算の道具（onnxruntime とモデル）は大きいので、ボタンが押されてから読む。
 * 写真は端末の中だけで処理する
 */
export async function measureRoom(): Promise<void> {
  const { backgroundUrl, backgroundAspect, lensFocal35, measure } = photoState.get();
  if (!backgroundUrl || !backgroundAspect || measure.status === 'running') return;
  const startedAt = Date.now();
  // 待っている間に写真が替わっていたら、その写真の結果ではないので捨てる
  const isCurrent = (): boolean => photoState.get().backgroundUrl === backgroundUrl;
  const report = (step: MeasureStep, download: DownloadProgress | null = null): void => {
    if (isCurrent()) photoState.set({ measure: { status: 'running', step, startedAt, download } });
  };

  try {
    report('download');
    const [{ loadCalibModel, calibratePhoto }, { loadDepthModel, estimateDepth }] = await Promise.all([
      import('@/core/photoCalibModel'),
      import('@/core/depthModel'),
    ]);

    // 2 つのモデルを同時に落とし、落とした量は足して 1 つの進み具合にする
    const downloads: Record<'calib' | 'depth', DownloadProgress> = {
      calib: { loaded: 0, total: null },
      depth: { loaded: 0, total: null },
    };
    let reportedAt = 0;
    const onDownload = (which: 'calib' | 'depth') => (progress: DownloadProgress): void => {
      downloads[which] = progress;
      const now = Date.now();
      if (now - reportedAt < PROGRESS_INTERVAL_MS) return;
      reportedAt = now;
      const { calib, depth } = downloads;
      report('download', {
        loaded: calib.loaded + depth.loaded,
        total: calib.total !== null && depth.total !== null ? calib.total + depth.total : null,
      });
    };
    await Promise.all([loadCalibModel(onDownload('calib')), loadDepthModel(onDownload('depth'))]);

    // EXIF に焦点距離があれば画角はそれで決まっている。解析には傾きだけを出させる
    report('calibrate');
    const exifVfov = lensFocal35 ? vfovFromFocal35(lensFocal35, backgroundAspect) : undefined;
    const calibration = await calibratePhoto(backgroundUrl, exifVfov);
    if (!isCurrent()) return;
    // 見下ろし角はそのまま。ロールはカメラの回す向きが逆なので符号を返す。
    // カメラの高さは、傾きと画角が変わったあとに main.ts が refreshCameraHeight で解き直す
    photoState.set({
      vfovDeg: calibration.vfovDeg,
      floorFit: clampFloorFit({ pitchDeg: calibration.pitchDeg, rollDeg: -calibration.rollDeg }),
    });

    report('depth');
    const depthMap = await estimateDepth(backgroundUrl, calibration.vfovDeg);
    if (!isCurrent()) return;
    photoState.set({ depthMap, measure: { status: 'done', seconds: (Date.now() - startedAt) / 1000 } });
    // 次に開いたときに計算し直さなくて済むように残す。残せなくても、いまの結果は使える
    saveDepth(depthMap).catch(() => {});
  } catch (error) {
    console.error('室内の寸法を計算できませんでした', error);
    if (isCurrent()) photoState.set({ measure: { status: 'failed' } });
  }
}

/** 端末に残しておいた奥行きを戻す（起動時の読み戻し）。計算は済んでいる扱いにする */
export function restoreDepth(depthMap: DepthMap): void {
  photoState.set({ depthMap, measure: { status: 'done', seconds: null } });
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
