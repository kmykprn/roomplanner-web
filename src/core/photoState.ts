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
  estimateCameraHeight,
  findFloorPlane,
  fitDepthScale,
  levelPointAt,
  photoPointOf,
  worldPointAt,
  type DepthScale,
  type Lens,
  type PhotoPose,
} from '@/core/depthPlacement';
import { EYE_DISTANCE } from '@/interaction/photoCamera';
import { clearHistory } from '@/core/editHistory';

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
 * 室内の寸法の計算（寸法の画面の「保存」）の様子。
 *
 *   idle    … まだ計算していない
 *   running … 保存を押したが、写真の解析（裏で走っている）の終わりを待っている。押した時刻から経過秒数を出す
 *   done    … 計算した
 *   failed  … 計算できなかった。もう一度ボタンを押してもらう。
 *             reason が lines なら、線の端が奥行きの分からない所にあった（線を動かしてもらう）
 */
export type MeasureState =
  | { status: 'idle' }
  | { status: 'running'; startedAt: number }
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
   * 写真を撮った高さ（カメラから床までの m）。写真の解析で奥行きから見積もる（core/depthPlacement.ts）。
   * まだ解析していない・見積もれなかったときは null で、立って撮った前提の高さ（CAMERA_HEIGHT）を使う
   */
  cameraHeight: number | null;
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
  /**
   * 写真の奥行きから、家具より手前にある物を自動で見つけて手前に出すか（scene/depthOccluder.ts）。
   * 写真を選び直しても変えない（利用者の好み）。手で塗った範囲（maskUrl）は、これと別に足される
   */
  depthOcclusion: boolean;
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
  cameraHeight: null,
  scaleLines: [],
  selectedScaleLine: 0,
  depthScale: null,
  isScaling: false,
  isFramingPhoto: false,
  maskUrl: null,
  depthOcclusion: true,
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
  // 置いてある家具が、いまの写真のどこに写っているか。写真を変えたあとも、新しい写真の同じ点に置く
  // （画角・傾き・撮った高さは写真ごとに違うので、3D の位置のままにすると、画面の外や遠くへ行ってしまう）
  const furniturePoints = furnitureOnPhoto();
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
  placeOnPhoto(furniturePoints);
  deleteDepth().catch(() => {});
  // 前の写真での家具の操作は、別の写真では戻せても意味がないので捨てる
  clearHistory(photoScene);

  // 次に開いたときも残っているように、縮めた1枚を端末に置く。
  // 置けなくても（容量・プライベートモード）いま見えているものは変わらない
  saveBackground(shrunk).catch(() => {});

  // 前の写真で寄ったままだと、新しい写真がいきなり拡大された状態で出る。
  // 隠す場所も前の写真のものなので消す
  photoState.set({ view: { ...DEFAULT_PHOTO_VIEW } });
  clearMask();
  // 選んだ直後に、表示する範囲を決めてもらう。その間に、裏で写真の解析を始める。
  // 寸法の画面は開かない（解析した奥行きから撮った高さを出すので、寸法を合わせなくても大きさはほぼ合う）
  setFramingPhoto(true);
  startAnalysis();
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
  clearHistory(photoScene);
  clearMask();
}

/** 隠す場所を塗っている最中かを切り替える */
export function setMasking(isMasking: boolean): void {
  if (photoState.get().isMasking !== isMasking) photoState.set({ isMasking });
}

/** 家具より手前にある物を、写真の奥行きから自動で見つけるかを切り替える */
export function setDepthOcclusion(depthOcclusion: boolean): void {
  if (photoState.get().depthOcclusion !== depthOcclusion) photoState.set({ depthOcclusion });
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
const FRESH_MEASURE: Pick<PhotoState, 'measure' | 'depthMap' | 'cameraHeight' | 'depthScale'> = {
  measure: { status: 'idle' },
  depthMap: null,
  cameraHeight: null,
  depthScale: null,
};

/**
 * 寸法の画面に入る前の見え方。寸法の画面では線を細かく合わせるために拡大・縮小できるが、
 * 背景の表示範囲（拡大・縮小の画面で決めたもの）は変えたくないので、出るときにこれへ戻す
 */
let viewBeforeScaling: PhotoView | null = null;

/**
 * 寸法を合わせる姿に入る・出る。入ったとき、線がまだ無ければ見えている範囲の中に 1 本作る。
 * 出たとき（保存・戻る・ほかのタブへ移る、のどれでも）は、入る前の見え方に戻す
 */
export function setScaling(isScaling: boolean): void {
  const { scaleLines, view } = photoState.get();
  if (photoState.get().isScaling === isScaling) return;
  if (isScaling) {
    viewBeforeScaling = { ...view };
    const firstLine = scaleLines.length === 0;
    photoState.set({ isScaling, ...(firstLine ? { scaleLines: [defaultLine(visibleRegion())], selectedScaleLine: 0 } : {}) });
    return;
  }
  const restored = viewBeforeScaling;
  viewBeforeScaling = null;
  photoState.set({ isScaling, ...(restored ? { view: restored } : {}) });
}

/**
 * 端末に残す見え方。寸法の画面で一時的に寄っている間は、入る前の見え方を残す
 * （その最中に閉じても、次に開いたときに背景の表示範囲が変わっていないように）
 */
export function settledView(): PhotoView {
  return viewBeforeScaling ?? photoState.get().view;
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

/** 写真を撮った高さ（m）。見積もれていなければ、立って撮った前提の高さ */
export function photoCameraHeight(): number {
  return photoState.get().cameraHeight ?? CAMERA_HEIGHT;
}

/** 写真を描いているカメラの向きと位置（interaction/photoCamera.ts と同じ置き方） */
function currentPose(): PhotoPose {
  return { fit: photoState.get().floorFit, position: [0, photoCameraHeight(), EYE_DISTANCE] };
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

/**
 * 家具より手前にある物の面（scene/depthOccluder.ts）を作る材料。自動で見つけない・奥行きがまだ無いなら null。
 * 寸法を合わせていれば、家具を置くときと同じ直し方を当てる。合わせていなければ奥行きをそのまま使う
 * （撮った高さも同じ奥行きから出しているので、家具と面の大きさがそろう）
 */
export function occluderSource(): { map: DepthMap; scale: DepthScale; lens: Lens } | null {
  const { depthOcclusion, depthMap, depthScale } = photoState.get();
  const lens = depthLens();
  if (!depthOcclusion || !depthMap || !lens) return null;
  return { map: depthMap, scale: depthScale ?? { a: 1, b: 0 }, lens };
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

/**
 * カメラが変わっても（画角・傾き・撮った高さ）、家具が写真の同じ場所に写ったままになるよう置き直す。
 *
 * 写真の解析は裏で進むので、終わる前に置いた家具がある。解析の結果でカメラが変わると、
 * そのままでは家具が画面の上で動いてしまう。変える前に写真のどこに写っていたかを控え、
 * 変えたあと、同じ点を通る視線と、その家具の足元の高さの水平な面との交点へ置き直す
 */
export function keepOnPhoto(change: () => void): void {
  const points = furnitureOnPhoto();
  change();
  placeOnPhoto(points);
}

/**
 * 写真の点に写るように置き直すとき、カメラからこれより遠くなるなら、新しく置くときの場所に置く（m）。
 * 写真の点が地平線のすぐ下だと、その点を通る視線は床とずっと遠くで交わり、家具が豆粒になって見失う
 */
const MAX_KEEP_DISTANCE = 12;

/**
 * 家具を、控えた写真の点に写るよう、いまのカメラで置き直す（足元の高さは変えない）。
 * 写真の点を通る視線が足元の高さの面と交わらない（地平線より上）か、交わっても遠すぎる家具は、
 * 新しく家具を置くときと同じ場所（画面の中央・下から 3 割）に置く。どちらでも画面の外には行かない
 */
function placeOnPhoto(points: Map<string, PhotoPoint>): void {
  const lens = depthLens() ?? lensSource?.();
  if (!lens || points.size === 0) return;
  const pose = currentPose();
  const fallback = (): [number, number, number] => placementFromCamera?.() ?? FALLBACK_PLACEMENT;
  const furniture = photoState.get().furniture.map((item) => {
    const point = points.get(item.id);
    if (!point) return item;
    const kept = levelPointAt(point, item.position[1], lens, pose);
    const near = kept && Math.hypot(kept[0] - pose.position[0], kept[2] - pose.position[2]) <= MAX_KEEP_DISTANCE;
    if (kept && near) return { ...item, position: kept };
    const [x, , z] = fallback();
    return { ...item, position: [x, item.position[1], z] as [number, number, number] };
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

/**
 * 写真の解析（傾き・画角と奥行き）。背景の写真を選んだら裏で始める（startAnalysis）。
 * 同じ写真で 2 度走らないよう、いま走っている（または走り終えた）解析を写真ごとに 1 つ持つ。
 * 失敗したときは failed にしておき、裏では繰り返さない（保存を押したときにやり直す）
 */
let analysis: { url: string; promise: Promise<boolean>; failed: boolean } | null = null;

/** この写真の解析を始める（走っていればそれを待つ）。retry なら失敗していてもやり直す。奥行きが出たら true */
function analyze(retry: boolean): Promise<boolean> {
  const { backgroundUrl, backgroundAspect, lensFocal35 } = photoState.get();
  if (!backgroundUrl || !backgroundAspect) return Promise.resolve(false);
  if (analysis?.url === backgroundUrl && !(retry && analysis.failed)) return analysis.promise;
  const current = { url: backgroundUrl, promise: Promise.resolve(false), failed: false };
  current.promise = computeDepth(backgroundUrl, backgroundAspect, lensFocal35)
    .then(() => photoState.get().backgroundUrl === backgroundUrl && photoState.get().depthMap !== null)
    .catch((error: unknown) => {
      console.error('写真を解析できませんでした', error);
      return false;
    })
    .then((ok) => {
      current.failed = !ok;
      return ok;
    });
  analysis = current;
  return current.promise;
}

/**
 * 背景の写真の解析を裏で始める。写真を選んだとき・起動時に写真を読み戻したとき（奥行きが残っていなければ）に呼ぶ。
 * 解析が終わると、傾きと画角がすぐ家具に効き、寸法の画面の保存は線に合わせ直すだけで済む。
 * 進み具合は画面に出さない（出すのは、保存を押して解析の終わりを待つときだけ）
 */
export function startAnalysis(): void {
  const { backgroundStatus, depthMap } = photoState.get();
  if (backgroundStatus !== 'ready' || depthMap) return;
  void analyze(false);
}

/**
 * 室内の寸法を計算する（寸法の画面の「保存」）。計算できたら true。
 *
 * 写真の解析（傾き・画角と奥行き）は裏で済んでいることが多い。まだなら終わりを待ち、
 * 失敗していたらやり直す。そのあと奥行きを線の長さに合わせる（1 秒かからない）
 */
export async function measureRoom(): Promise<boolean> {
  const { backgroundUrl, backgroundAspect, measure, scaleLines } = photoState.get();
  const lines = measuredLines(scaleLines);
  if (!backgroundUrl || !backgroundAspect || measure.status === 'running' || lines.length === 0) return false;
  // 家具がいま写真のどこに写っているかを先に控える。傾きと画角が変わっても、同じ場所に置き直すため
  const furnitureAt = furnitureOnPhoto();
  // 待っている間に写真が替わっていたら、その写真の結果ではないので捨てる
  const isCurrent = (): boolean => photoState.get().backgroundUrl === backgroundUrl;

  if (!photoState.get().depthMap) {
    photoState.set({ measure: { status: 'running', startedAt: Date.now() } });
    const ok = await analyze(true);
    if (!isCurrent()) return false;
    if (!ok) {
      photoState.set({ measure: { status: 'failed', reason: 'compute' } });
      return false;
    }
  }
  const { depthMap } = photoState.get();
  const lens = depthLens();
  if (!depthMap || !lens) return false;

  const scale = fitDepthScale(lines, depthMap, lens);
  if (!scale) {
    photoState.set({ measure: { status: 'failed', reason: 'lines' } });
    return false;
  }
  photoState.set({ depthScale: { ...scale, lines }, measure: { status: 'done' } });
  placeFurnitureOnDepth(furnitureAt);
  return true;
}

/**
 * 写真の傾き・画角と奥行きを出して、状態に入れる。
 * 写真が途中で替わったら、入れずに終わる（呼んだ側が確かめる）。
 * 計算の道具（onnxruntime とモデル）は大きいので、ここで初めて読む。写真は端末の中だけで処理する
 */
async function computeDepth(backgroundUrl: string, backgroundAspect: number, lensFocal35: number | null): Promise<void> {
  const isCurrent = (): boolean => photoState.get().backgroundUrl === backgroundUrl;
  const [{ calibratePhoto }, { runDepthNetwork, estimateVfov, depthFromOutput }] = await Promise.all([
    import('@/core/photoCalibModel'),
    import('@/core/depthModel'),
  ]);

  // 1. 奥行きの AI を先に動かす（画角を推定するのに、その出力を使う）
  const network = await runDepthNetwork(backgroundUrl);
  if (!isCurrent()) return;
  // 2. 画角: EXIF に焦点距離があればそれ、無ければ奥行きの AI に推定させる（傾きの AI より合う）
  const vfovDeg = lensFocal35 ? vfovFromFocal35(lensFocal35, backgroundAspect) : estimateVfov(network);
  // 3. 傾きの AI には、その画角を渡して見下ろし角・傾きだけを出させる。ロールはカメラの回す向きが逆なので符号を返す
  const calibration = await calibratePhoto(backgroundUrl, vfovDeg);
  if (!isCurrent()) return;
  const prior = clampFloorFit({ pitchDeg: calibration.pitchDeg, rollDeg: -calibration.rollDeg });
  const depthMap = depthFromOutput(network.output, network.photoWidth, network.photoHeight, vfovDeg);
  // 4. 床の面から、見下ろし角・傾きと撮った高さを決める。見つからない・怪しいときは、傾きの AI の値と、
  //    奥行きの点から見積もった高さにする
  const lens = { vfovDeg, aspect: backgroundAspect };
  const floor = findFloorPlane(depthMap, lens, prior);
  const floorFit = floor ? clampFloorFit(floor.fit) : prior;
  const cameraHeight = floor ? floor.cameraHeight : estimateCameraHeight(depthMap, lens, floorFit);
  keepOnPhoto(() => photoState.set({ vfovDeg, floorFit, depthMap, cameraHeight }));
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
