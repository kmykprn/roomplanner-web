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
  defaultLine,
  MAX_SCALE_LINES,
  measuredLines,
  type ScaleLine,
  type VisibleRegion,
} from '@/core/scaleLine';
import {
  fitDepthScale,
  photoPointOf,
  worldPointAt,
  type DepthScale,
  type Lens,
  type PhotoPose,
} from '@/core/depthPlacement';
import { EYE_DISTANCE } from '@/interaction/photoCamera';

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
 * 室内の寸法の計算（寸法の画面の「保存」）で、いまやっていること。
 *
 *   download  … 計算に使うデータ（モデル）を落としている。初回だけ
 *   calibrate … 写真の傾きと画角を出している（core/photoCalibModel.ts）
 *   depth     … 写真の奥行きを出している（core/depthModel.ts）
 *   fit       … 奥行きの倍率を線の長さに合わせている（core/depthPlacement.ts）
 */
export type MeasureStep = 'download' | 'calibrate' | 'depth' | 'fit';

/**
 * 室内の寸法の計算の様子。
 *
 *   idle    … まだ計算していない
 *   running … 計算中。始めた時刻から経過秒数を出す
 *   done    … 計算した
 *   failed  … 計算できなかった。もう一度ボタンを押してもらう。
 *             reason が lines なら、線の端が奥行きの分からない所にあった（線を動かしてもらう）
 */
export type MeasureState =
  | { status: 'idle' }
  | { status: 'running'; step: MeasureStep; startedAt: number; download: DownloadProgress | null }
  | { status: 'done' }
  | { status: 'failed'; reason: 'compute' | 'lines' };

/** 線の長さに合わせた奥行きの直し方と、そのとき使った線（線を変えたら計算し直してもらうため） */
export interface FittedScale extends DepthScale {
  lines: ScaleLine[];
}

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
   * 寸法を合わせる線（core/scaleLine.ts）。最大 5 本。まだ出していなければ空で、
   * 寸法の画面に入ったときに見えている範囲の中に 1 本作る
   */
  scaleLines: ScaleLine[];
  /** 選んでいる線（寸法の画面で太く描き、欄を強調する） */
  selectedScaleLine: number;
  /**
   * 線の長さに合わせた奥行きの直し方。寸法の画面の「保存」で計算して決まる。
   * これと奥行きの地図がそろっている間は、家具を足元の奥行きに合わせて置く（core/depthPlacement.ts）
   */
  depthScale: FittedScale | null;
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
  scaleLines: [],
  selectedScaleLine: 0,
  depthScale: null,
  isScaling: false,
  isFramingPhoto: false,
  maskUrl: null,
  isMasking: false,
  // 太い筆を既定にする（広い面を手早く塗る用途が多い）
  maskTool: { kind: 'brush', thick: true },
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
 * いま写真を描いているカメラの画角を返す関数。main.ts が入れる。
 * 室内の寸法を計算する前の家具が、写真のどこに写っているかを出すのに要る
 */
let lensSource: (() => Lens) | null = null;

export function setLensSource(source: () => Lens): void {
  lensSource = source;
}

/** 寸法の線を、写真ごとの初期状態に戻す。新しい写真を選んだとき・外したとき */
const FRESH_SCALE: Pick<PhotoState, 'scaleLines' | 'selectedScaleLine'> = {
  scaleLines: [],
  selectedScaleLine: 0,
};

/** 室内の寸法の計算を、写真ごとの初期状態に戻す。新しい写真を選んだとき・外したとき */
const FRESH_MEASURE: Pick<PhotoState, 'measure' | 'depthMap' | 'depthScale'> = {
  measure: { status: 'idle' },
  depthMap: null,
  depthScale: null,
};

/** 寸法を合わせる姿に入る・出る。入ったとき、線がまだ無ければ見えている範囲の中に 1 本作る */
export function setScaling(isScaling: boolean): void {
  const { scaleLines } = photoState.get();
  if (photoState.get().isScaling === isScaling) return;
  const firstLine = isScaling && scaleLines.length === 0;
  photoState.set({ isScaling, ...(firstLine ? { scaleLines: [defaultLine(visibleRegion())], selectedScaleLine: 0 } : {}) });
}

/** 線を 1 本足して、その線を選ぶ。上限（5 本）に達していれば何もしない */
export function addScaleLine(): void {
  const { scaleLines } = photoState.get();
  if (scaleLines.length >= MAX_SCALE_LINES) return;
  photoState.set({
    scaleLines: [...scaleLines, defaultLine(visibleRegion(), scaleLines.length)],
    selectedScaleLine: scaleLines.length,
  });
}

/** 線を 1 本消す。最後の 1 本は消さない（線が無いと合わせられない） */
export function removeScaleLine(index: number): void {
  const { scaleLines, selectedScaleLine } = photoState.get();
  if (scaleLines.length <= 1) return;
  const next = scaleLines.filter((_, i) => i !== index);
  photoState.set({ scaleLines: next, selectedScaleLine: Math.min(selectedScaleLine, next.length - 1) });
}

/** 線の端か長さを変える */
export function updateScaleLine(index: number, patch: Partial<ScaleLine>): void {
  const { scaleLines } = photoState.get();
  if (!scaleLines[index]) return;
  photoState.set({ scaleLines: scaleLines.map((line, i) => (i === index ? { ...line, ...patch } : line)) });
}

export function selectScaleLine(index: number): void {
  if (photoState.get().selectedScaleLine !== index) photoState.set({ selectedScaleLine: index });
}

/** 線を丸ごと入れ替える（寸法の画面の「戻る」で、入ったときの線に戻すため） */
export function setScaleLines(scaleLines: ScaleLine[]): void {
  photoState.set({ scaleLines, selectedScaleLine: Math.min(photoState.get().selectedScaleLine, Math.max(0, scaleLines.length - 1)) });
}

/**
 * まだ家具に反映していない線があるか。長さの入った線が 1 本以上あり、
 * まだ計算していないか、計算に使った線から変わっていれば true（寸法の画面の「保存」で計算する）
 */
export function hasUnsavedScale(): boolean {
  const { scaleLines, depthScale } = photoState.get();
  const lines = measuredLines(scaleLines);
  if (lines.length === 0) return false;
  return depthScale === null || JSON.stringify(lines) !== JSON.stringify(depthScale.lines);
}

/**
 * 奥行きから 3D の位置を出すときの画角。計算で出した画角と写真の縦横比。
 *
 * 描いているカメラ（lensSource）からは取らない。状態を変えてからカメラに届くまでの間は
 * カメラが前の画角のままで、計算の直後に線の長さを合わせると倍率が大きくずれた
 */
function depthLens(): Lens | null {
  const { vfovDeg, backgroundAspect } = photoState.get();
  return vfovDeg !== null && backgroundAspect !== null ? { vfovDeg, aspect: backgroundAspect } : null;
}

/** 写真を描いているカメラの向きと位置（interaction/photoCamera.ts と同じ置き方） */
function currentPose(): PhotoPose {
  return { fit: photoState.get().floorFit, position: [0, CAMERA_HEIGHT, EYE_DISTANCE] };
}

/**
 * 写真の点に写っている物の 3D の位置。家具をそこに立たせると、足元の奥行きに合った大きさで写る。
 * 室内の寸法を計算していない・写真の外・奥行きが分からない所なら null
 */
export function depthPointAt(point: PhotoPoint): [number, number, number] | null {
  const { depthMap, depthScale } = photoState.get();
  const lens = depthLens();
  if (!depthMap || !depthScale || !lens) return null;
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
  return worldPointAt(point, depthMap, depthScale, lens, currentPose());
}

/** 置いてある家具の足元が、いま写真のどこに写っているか。家具ごと */
function furnitureOnPhoto(): Map<string, PhotoPoint> {
  const points = new Map<string, PhotoPoint>();
  if (!lensSource) return points;
  const lens = lensSource();
  const pose = currentPose();
  for (const item of photoState.get().furniture) {
    const point = photoPointOf(item.position, lens, pose);
    if (point) points.set(item.id, point);
  }
  return points;
}

/** 家具を、写真の同じ場所に写ったまま、足元の奥行きの位置へ置き直す。奥行きが分からない家具はそのまま */
function placeFurnitureOnDepth(points: Map<string, PhotoPoint>): void {
  const furniture = photoState.get().furniture.map((item) => {
    const point = points.get(item.id);
    const position = point ? depthPointAt(point) : null;
    return position ? { ...item, position } : item;
  });
  photoState.set({ furniture });
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
 * 室内の寸法を計算する（寸法の画面の「保存」）。計算できたら true。
 *
 * 写真の傾きと画角（GeoCalib）と、写真の奥行き（MoGe-2）をまとめて出す。
 * 奥行きは画角が分かっている前提で出すので、傾きと画角が先。
 * 計算の道具（onnxruntime とモデル）は大きいので、ボタンが押されてから読む。
 * 写真は端末の中だけで処理する
 */
export async function measureRoom(): Promise<boolean> {
  const { backgroundUrl, backgroundAspect, lensFocal35, measure, scaleLines } = photoState.get();
  const lines = measuredLines(scaleLines);
  if (!backgroundUrl || !backgroundAspect || measure.status === 'running' || lines.length === 0) return false;
  const startedAt = Date.now();
  // 家具がいま写真のどこに写っているかを先に控える。傾きと画角が変わっても、同じ場所に置き直すため
  const furnitureAt = furnitureOnPhoto();
  // 待っている間に写真が替わっていたら、その写真の結果ではないので捨てる
  const isCurrent = (): boolean => photoState.get().backgroundUrl === backgroundUrl;
  const report = (step: MeasureStep, download: DownloadProgress | null = null): void => {
    if (isCurrent()) photoState.set({ measure: { status: 'running', step, startedAt, download } });
  };

  try {
    // 奥行きをこの写真で計算済みなら、線の長さに合わせ直すだけで済む（1 秒かからない）
    if (!photoState.get().depthMap) await computeDepth(backgroundUrl, backgroundAspect, lensFocal35, report);
    const { depthMap } = photoState.get();
    const lens = depthLens();
    if (!isCurrent() || !depthMap || !lens) return false;

    report('fit');
    const scale = fitDepthScale(lines, depthMap, lens);
    if (!scale) {
      photoState.set({ measure: { status: 'failed', reason: 'lines' } });
      return false;
    }
    photoState.set({
      depthScale: { ...scale, lines },
      measure: { status: 'done' },
    });
    placeFurnitureOnDepth(furnitureAt);
    return true;
  } catch (error) {
    console.error('室内の寸法を計算できませんでした', error);
    if (isCurrent()) photoState.set({ measure: { status: 'failed', reason: 'compute' } });
    return false;
  }
}

/**
 * 写真の傾き・画角と奥行きを出して、状態に入れる。
 * 写真が途中で替わったら、入れずに終わる（呼んだ側が isCurrent で確かめる）
 */
async function computeDepth(
  backgroundUrl: string,
  backgroundAspect: number,
  lensFocal35: number | null,
  report: (step: MeasureStep, download?: DownloadProgress | null) => void
): Promise<void> {
  const isCurrent = (): boolean => photoState.get().backgroundUrl === backgroundUrl;
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
  // 見下ろし角はそのまま。ロールはカメラの回す向きが逆なので符号を返す
  photoState.set({
    vfovDeg: calibration.vfovDeg,
    floorFit: clampFloorFit({ pitchDeg: calibration.pitchDeg, rollDeg: -calibration.rollDeg }),
  });

  report('depth');
  const depthMap = await estimateDepth(backgroundUrl, calibration.vfovDeg);
  if (!isCurrent()) return;
  photoState.set({ depthMap });
  // 次に開いたときに計算し直さなくて済むように残す。残せなくても、いまの結果は使える
  saveDepth(depthMap).catch(() => {});
}

/**
 * 端末に残しておいた奥行きを戻す（起動時の読み戻し）。
 * 線の長さに合わせ終えていれば（直し方も戻っていれば）、計算は済んでいる扱いにする
 */
export function restoreDepth(depthMap: DepthMap): void {
  const measured = photoState.get().depthScale !== null;
  photoState.set({ depthMap, measure: measured ? { status: 'done' } : { status: 'idle' } });
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
