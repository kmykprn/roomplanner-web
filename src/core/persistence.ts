/**
 * 部屋の状態を端末に残す。
 *
 * 生成に8分かかるものを置いた直後にリロードで消える、という状態を避けるため。
 * 「アプリを閉じても残る」を成立させるには、待ち状態（generation.ts）だけでなく
 * **置いた家具そのもの**も残す必要がある。
 *
 * 保存先は localStorage。部屋と家具の一覧は数KBにしかならないので十分で、
 * 同期的に読めるぶん起動時の扱いが単純になる。
 * GLB の中身は大きいので Cache Storage に分けてある（modelCache.ts）。
 */

import { appState, type AppState } from '@/core/appState';

const STORAGE_KEY = 'roomplanner.room';

/**
 * 保存した状態を読み戻す。**シーンを組み立てる前**に呼ぶ。
 *
 * 壊れた値が入っていても起動できなくならないよう、読めなければ既定のまま進む。
 */
export function restoreRoom(): void {
  let saved: Partial<AppState> | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    saved = null;
  }
  if (!saved) return;

  // 選択状態は残さない。前回選んでいた家具が消えている可能性があり、
  // 復元しても操作の手掛かりにならない
  appState.set({
    room: saved.room ?? appState.get().room,
    furniture: Array.isArray(saved.furniture) ? saved.furniture : [],
    selectedId: null,
  });
}

/** 変化したら保存する。起動時に一度だけ呼ぶ */
export function persistRoomOnChange(): void {
  appState.subscribe((state) => {
    try {
      // 選択状態は保存しない（上と同じ理由）
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ room: state.room, furniture: state.furniture })
      );
    } catch {
      // 容量超過やプライベートモード。保存できなくても操作は続けられる
    }
  });
}
