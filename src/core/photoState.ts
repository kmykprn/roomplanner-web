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
import { deleteBackground, deleteMask, saveBackground } from '@/platform/backgroundStore';
import { clampPhotoView, DEFAULT_PHOTO_VIEW, type PhotoView } from '@/core/photoView';

/**
 * 背景写真の読み込み具合。
 *
 * **成否を状態として持つ。** 画面に出さないと、読み込めなかったときに
 * 「黒いまま」としか分からず、原因の切り分けができない。
 */
export type BackgroundStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** 隠す場所を塗る筆の設定 */
export interface MaskTool {
  /** 消しゴム。塗った場所を元に戻す */
  erase: boolean;
  /** 太い筆。広い面を手早く塗るためのもの */
  thick: boolean;
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

  /**
   * 隠す場所（家具の手前にある物）のマスク画像の URL。無ければ null。
   *
   * 塗った形をそのまま画像で持つ。写真をこの形で切り抜いて 3D の上に重ねると、
   * その場所だけ写真が家具の手前に出る（3D 側は何も知らない）
   */
  maskUrl: string | null;
  /** 隠す場所を塗っている最中か。この間は 1 本指が筆になる */
  isMasking: boolean;
  maskTool: MaskTool;
}

export const photoState = createStore<PhotoState>({
  backgroundUrl: null,
  backgroundName: null,
  backgroundStatus: 'idle',
  backgroundAspect: null,
  view: { ...DEFAULT_PHOTO_VIEW },
  maskUrl: null,
  isMasking: false,
  maskTool: { erase: false, thick: false },
  furniture: [],
  selectedId: null,
});

/**
 * 新しい家具を並べる横幅の半分（メートル）。
 *
 * 写真モードでは奥行きを使わない（奥へ置くと小さく写り、写真の床と合っていない
 * 以上その縮み方に意味がない）。**奥行き 0 の横一列**にだけ並べる
 */
const PHOTO_ROW_HALF_WIDTH = 8;

/** 写真モードの置き場。UI とドラッグ操作はこの形で受け取る */
export const photoScene = createFurnitureScene(photoState, {
  // 奥行きの許容幅を家具の厚みちょうどにすると、z = 0 の候補だけが残る
  placementFor: (size) =>
    findFreeSpot(photoState.get().furniture, size, {
      limit: { halfWidth: PHOTO_ROW_HALF_WIDTH, halfDepth: size[2] / 2 },
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

  let shrunk: Blob;
  try {
    // 原寸のままだと Safari が描かないことがあるので、表示用に縮めてから渡す
    shrunk = await shrinkForDisplay(file);
  } catch {
    photoState.set({ backgroundStatus: 'failed' });
    return;
  }

  if (!(await showBackground(shrunk))) return;

  // 次に開いたときも残っているように、縮めた1枚を端末に置く。
  // 置けなくても（容量・プライベートモード）いま見えているものは変わらない
  saveBackground(shrunk).catch(() => {});

  // 前の写真で寄ったままだと、新しい写真がいきなり拡大された状態で出る。
  // 隠す場所も前の写真のものなので消す
  photoState.set({ view: { ...DEFAULT_PHOTO_VIEW } });
  clearMask();
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
  });
  // 端末に残した1枚も捨てる。次に開いたときに戻ってこないように
  deleteBackground().catch(() => {});
  clearMask();
}

/** 隠す場所を塗っている最中かを切り替える */
export function setMasking(isMasking: boolean): void {
  if (photoState.get().isMasking !== isMasking) photoState.set({ isMasking });
}

export function setMaskTool(patch: Partial<MaskTool>): void {
  photoState.set({ maskTool: { ...photoState.get().maskTool, ...patch } });
}

/**
 * マスク画像を差し替え、前の URL を解放する。
 * 塗り終わるたび（interaction/maskPaint.ts）と、起動時に読み戻したときに呼ぶ
 */
export function setMaskUrl(url: string | null): void {
  const previous = photoState.get().maskUrl;
  if (previous && previous.startsWith('blob:')) URL.revokeObjectURL(previous);
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
    image.onerror = () => reject(new Error('画像として読み込めませんでした'));
    image.src = url;
  });
}
