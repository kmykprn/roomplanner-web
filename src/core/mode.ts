/**
 * いま部屋を作っているのか、写真の上に置いているのか。
 *
 * 3D シーンは1つのまま、表示するものと触る対象を切り替える。
 * どちらを触っているかを知る必要があるのは、切り替えを行う main.ts と、
 * タブの出し分けをする UI だけ。**家具を操作する側は `activeScene()` だけを見る。**
 */

import { createStore } from '@/core/store';
import { roomScene } from '@/core/appState';
import { photoScene } from '@/core/photoState';
import type { EditableScene } from '@/core/furnitureScene';

export type Mode = 'room' | 'photo';

export const modeState = createStore<{ mode: Mode }>({ mode: 'room' });

export function setMode(mode: Mode): void {
  if (modeState.get().mode !== mode) modeState.set({ mode });
}

export function isPhotoMode(): boolean {
  return modeState.get().mode === 'photo';
}

/** いま触っている家具の置き場 */
export function activeScene(): EditableScene {
  return isPhotoMode() ? photoScene : roomScene;
}
