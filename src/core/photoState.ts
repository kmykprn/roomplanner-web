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
import {
  clampFloorView,
  DEFAULT_FLOOR_VIEW,
  floorGridCenter,
  type FloorView,
} from '@/core/floorView';

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
  /** 背景写真の縦横比（幅 ÷ 高さ）。写真の矩形の中だけに描くために要る */
  backgroundAspect: number | null;

  /** 床の見え方。これを写真に合わせてもらう */
  floorView: FloorView;
  /** 床を合わせている最中か。方眼はこの間だけ出す */
  isAligning: boolean;
}

export const photoState = createStore<PhotoState>({
  backgroundUrl: null,
  backgroundName: null,
  backgroundStatus: 'idle',
  backgroundAspect: null,
  floorView: { ...DEFAULT_FLOOR_VIEW },
  isAligning: false,
  furniture: [],
  selectedId: null,
});

/** 写真モードの置き場。UI とドラッグ操作はこの形で受け取る */
export const photoScene = createFurnitureScene(photoState, {
  // カメラは原点の真上にあるので、原点に置くと足元（画面の外）に出てしまう。
  // 方眼を敷いた場所を中心にして空きを探す（置いた家具が方眼の上に出る）
  placementFor: (size) =>
    findFreeSpot(photoState.get().furniture, size, {
      center: floorGridCenter(photoState.get().floorView),
    }),

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
  // 写真が変われば床も変わる。合わせ直してもらう
  photoState.set({
    backgroundStatus: 'ready',
    backgroundAspect: aspect,
    floorView: { ...DEFAULT_FLOOR_VIEW },
  });
}

/** 背景の写真を外す */
export function clearBackground(): void {
  replaceBackgroundUrl(null);
  photoState.set({
    backgroundName: null,
    backgroundStatus: 'idle',
    backgroundAspect: null,
  });
}

/** 床を合わせている最中かを切り替える */
export function setAligning(isAligning: boolean): void {
  if (photoState.get().isAligning !== isAligning) photoState.set({ isAligning });
}

/**
 * 床の見え方を動かす。渡した項目だけを変え、範囲に収める。
 *
 * 指の操作（interaction/floorGesture.ts）とボタン（ui/alignPanel.ts）の
 * どちらもここを通る。**両方から同じ値を触るので、丸めは1箇所に置く。**
 */
export function adjustFloorView(patch: Partial<FloorView>): void {
  photoState.set({ floorView: clampFloorView({ ...photoState.get().floorView, ...patch }) });
}

/** 床の見え方を初期値に戻す */
export function resetFloorView(): void {
  photoState.set({ floorView: { ...DEFAULT_FLOOR_VIEW } });
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
