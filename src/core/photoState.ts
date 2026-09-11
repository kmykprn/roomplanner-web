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
  findFreeSpot,
  type FurnitureSceneState,
} from '@/core/furnitureScene';
import { shrinkForDisplay } from '@/core/imageResize';
import { calibrateFloor, type FloorCalibration, type FloorQuad } from '@/core/photoCalibration';

/**
 * 床合わせの四角の初期位置。
 *
 * 手前が広く奥が狭い台形にしてある。床の上の長方形は写真の中でこう写るので、
 * 4隅を大きく動かさずに済む。順番は 手前左 → 手前右 → 奥右 → 奥左 で、
 * `0→1`（手前の辺）が「横幅」になる。
 */
const DEFAULT_QUAD: FloorQuad = [
  { x: 0.25, y: 0.8 },
  { x: 0.75, y: 0.8 },
  { x: 0.65, y: 0.6 },
  { x: 0.35, y: 0.6 },
];

/** 四角の横幅の初期値（メートル）。ラグ1枚ぶんくらい */
const DEFAULT_WIDTH_METERS = 2;

/** 画角が計算で出せないときに使う値（度）。スマホの標準的なカメラに近いあたり */
const DEFAULT_FOV = 50;

/**
 * 背景写真の読み込み具合。
 *
 * **成否を状態として持つ。** 画面に出さないと、読み込めなかったときに
 * 「黒いまま」としか分からず、原因の切り分けができない。
 */
export type BackgroundStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface PhotoState extends FurnitureSceneState {
  /** 背景写真の表示用 URL（Blob URL）。未選択なら null */
  backgroundUrl: string | null;
  /** 選んだ写真のファイル名。どれを開いているか分かるように画面に出す */
  backgroundName: string | null;
  backgroundStatus: BackgroundStatus;
  /** 背景写真の縦横比（幅 ÷ 高さ）。床合わせの計算に要る */
  backgroundAspect: number | null;

  /** 床合わせの四角。写真の中の位置を 0〜1 で持つ（画面の大きさが変わっても保つ） */
  floorQuad: FloorQuad;
  /** 四角の `0→1` の辺の実寸（メートル）。これがスケールの基準になる */
  floorWidthMeters: number;
  /** 画角が計算で出せないときに使う値（度） */
  assumedFov: number;
  /** 床合わせの操作中か。四角と方眼はこの間だけ出す */
  isAligning: boolean;

  /**
   * 割り出したカメラ。まだ合わせていなければ null。
   *
   * **解けない形のあいだは直前の値を残す。** 角をドラッグしている最中は
   * ねじれた四角を必ず通るので、そのたびにカメラが消えると画面が点滅する。
   */
  calibration: FloorCalibration | null;
  /** いまの四角では割り出せないか。画面で知らせるために持つ */
  calibrationFailed: boolean;
}

export const photoState = createStore<PhotoState>({
  backgroundUrl: null,
  backgroundName: null,
  backgroundStatus: 'idle',
  backgroundAspect: null,
  floorQuad: DEFAULT_QUAD,
  floorWidthMeters: DEFAULT_WIDTH_METERS,
  assumedFov: DEFAULT_FOV,
  isAligning: false,
  calibration: null,
  calibrationFailed: false,
  furniture: [],
  selectedId: null,
});

/** 写真モードの置き場。UI とドラッグ操作はこの形で受け取る */
export const photoScene = createFurnitureScene(photoState, {
  placementFor: (size) => findFreeSpot(photoState.get().furniture, size),

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

  let url: string | null = null;
  let aspect: number;
  try {
    // 原寸のままだと Safari が描かないことがあるので、表示用に縮めてから渡す
    url = URL.createObjectURL(await shrinkForDisplay(file));
    const image = await decodeImage(url);
    aspect = image.naturalWidth / image.naturalHeight;
  } catch {
    if (url) URL.revokeObjectURL(url);
    photoState.set({ backgroundStatus: 'failed' });
    return;
  }

  replaceBackgroundUrl(url);
  // 写真が変われば床も変わる。四角は初期位置に戻す
  photoState.set({
    backgroundStatus: 'ready',
    backgroundAspect: aspect,
    floorQuad: DEFAULT_QUAD,
  });
  recalibrate();
}

/** 背景の写真を外す */
export function clearBackground(): void {
  replaceBackgroundUrl(null);
  photoState.set({
    backgroundName: null,
    backgroundStatus: 'idle',
    backgroundAspect: null,
    calibration: null,
    calibrationFailed: false,
  });
}

/** 床合わせの操作中かを切り替える */
export function setAligning(isAligning: boolean): void {
  if (photoState.get().isAligning !== isAligning) photoState.set({ isAligning });
}

/** 四角を動かす。動かすたびにカメラを割り出し直す */
export function setFloorQuad(floorQuad: FloorQuad): void {
  photoState.set({ floorQuad });
  recalibrate();
}

/** 四角の横幅の実寸を変える。スケール（カメラの高さ）が変わる */
export function setFloorWidthMeters(floorWidthMeters: number): void {
  if (!(floorWidthMeters > 0)) return;
  photoState.set({ floorWidthMeters });
  recalibrate();
}

/** 仮定する画角を変える。計算で出せている写真では結果は変わらない */
export function setAssumedFov(assumedFov: number): void {
  photoState.set({ assumedFov });
  recalibrate();
}

/**
 * いまの四角からカメラを割り出す。
 *
 * **解けなかったときは直前のカメラを残す。** 角をドラッグしている最中は
 * ねじれた四角や潰れた四角を必ず通るので、そのたびに消すと画面が点滅し、
 * 手を戻す先も分からなくなる。
 */
function recalibrate(): void {
  const { floorQuad, backgroundAspect, floorWidthMeters, assumedFov } = photoState.get();
  if (!backgroundAspect) return;

  const result = calibrateFloor(floorQuad, backgroundAspect, floorWidthMeters, assumedFov);
  photoState.set(
    result
      ? { calibration: result, calibrationFailed: false }
      : { calibrationFailed: true }
  );
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
    image.onerror = () => reject(new Error('画像として読み込めませんでした'));
    image.src = url;
  });
}
