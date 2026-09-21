/**
 * 部屋と写真の状態を端末に残す。
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
import { roomSizeFor } from '@/config/interior';
import { photoState, setMaskUrl, showBackground, type PhotoState } from '@/core/photoState';
import { readBackground, readMask } from '@/platform/backgroundStore';
import { normalizeFloorFit } from '@/core/floorFit';
import type { PlacedFurniture } from '@/config/furniture';
import type { FloorMeasure } from '@/core/photoMeasure';
import type { PhotoPoint } from '@/core/photoView';

const STORAGE_KEY = 'roomplanner.room';
const PHOTO_STORAGE_KEY = 'roomplanner.photo';

/** localStorage に残す写真モードの項目。写真そのものは大きいので IndexedDB（backgroundStore.ts） */
type SavedPhoto = Pick<PhotoState, 'furniture' | 'view' | 'backgroundName' | 'floorFit' | 'measures'>;

/**
 * 保存した状態を読み戻す。**シーンを組み立てる前**に呼ぶ。
 *
 * 壊れた値が入っていても起動できなくならないよう、読めなければ既定のまま進む。
 */
export function restoreRoom(): void {
  const saved = readSaved<Partial<AppState>>(STORAGE_KEY);
  if (!saved) return;

  // 選択状態は残さない。前回選んでいた家具が消えている可能性があり、
  // 復元しても操作の手掛かりにならない
  const interior = { ...appState.get().interior, ...(saved.interior ?? {}) };
  appState.set({
    // 部屋の大きさは内装（畳数）から決まるので、保存値ではなく内装から引き直す
    room: roomSizeFor(interior.template, interior.mats),
    interior,
    furniture: withBaseSize(saved.furniture),
    selectedId: null,
  });
}

/**
 * 置いたときの大きさを、覚えていない記録に補う。
 *
 * 「大きさ」のバーは置いたときの何倍かで動くので、基準が無いと真ん中が決まらない。
 * この項目より前に置いた家具には、いまの大きさをそのまま基準として入れる
 * （その家具にとっては、いまが「置いたとき」になる）
 */
function withBaseSize(furniture: unknown): PlacedFurniture[] {
  if (!Array.isArray(furniture)) return [];
  return (furniture as PlacedFurniture[]).map((item) =>
    item.baseSize ? item : { ...item, baseSize: [...item.size] as [number, number, number] }
  );
}

/** 壊れた値が保存されていても起動できるように、形の合うものだけ残す */
function normalizeMeasures(value: unknown): FloorMeasure[] {
  if (!Array.isArray(value)) return [];
  const isPoint = (p: unknown): p is PhotoPoint =>
    typeof p === 'object' && p !== null &&
    Number.isFinite((p as PhotoPoint).x) && Number.isFinite((p as PhotoPoint).y);
  return value.filter(
    (m): m is FloorMeasure =>
      typeof m === 'object' && m !== null &&
      isPoint((m as FloorMeasure).a) && isPoint((m as FloorMeasure).b) &&
      Number.isFinite((m as FloorMeasure).metres) && (m as FloorMeasure).metres > 0
  );
}

/**
 * 写真モードを読み戻す。
 *
 * 家具と寄り具合は同期的に戻し、写真そのものは IndexedDB から非同期に読んで
 * 出す。写真が残っていなければ「未選択」のまま（家具だけ残っていてもよい。
 * 写真を選び直せばそのまま乗る）
 */
export function restorePhoto(): void {
  const saved = readSaved<Partial<SavedPhoto>>(PHOTO_STORAGE_KEY);
  if (!saved) return;

  photoState.set({
    furniture: withBaseSize(saved.furniture),
    view: saved.view ?? photoState.get().view,
    // 壊れた値が入っていても起動できるよう、読めなければ既定の傾きに戻す
    floorFit: normalizeFloorFit(saved.floorFit),
    measures: normalizeMeasures(saved.measures),
    backgroundName: saved.backgroundName ?? null,
    selectedId: null,
  });

  readBackground()
    .then(async (blob) => {
      if (!blob) {
        // 名前だけ残って写真が無い状態にしない
        photoState.set({ backgroundName: null });
        return;
      }
      if (!(await showBackground(blob))) return;
      // 隠す場所は写真に付いているものなので、写真が出せたときだけ戻す
      const mask = await readMask();
      if (mask) setMaskUrl(URL.createObjectURL(mask));
    })
    .catch(() => {
      // 読めなくても起動は続ける。写真を選び直せばよい
    });
}

/** 壊れた値が入っていても起動できなくならないよう、読めなければ null にする */
function readSaved<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

/** 変化したら保存する。起動時に一度だけ呼ぶ */
export function persistRoomOnChange(): void {
  appState.subscribe((state) => {
    try {
      // 選択状態は保存しない（上と同じ理由）
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ room: state.room, interior: state.interior, furniture: state.furniture })
      );
    } catch {
      // 容量超過やプライベートモード。保存できなくても操作は続けられる
    }
  });
}

/** 変化したら保存する。起動時に一度だけ呼ぶ */
export function persistPhotoOnChange(): void {
  photoState.subscribe((state) => {
    // 読み込みの途中は残さない。名前だけ先に入って写真が無い、という中途半端を防ぐ
    if (state.backgroundStatus === 'loading') return;
    const saved: SavedPhoto = {
      furniture: state.furniture,
      view: state.view,
      floorFit: state.floorFit,
      measures: state.measures,
      backgroundName: state.backgroundStatus === 'ready' ? state.backgroundName : null,
    };
    try {
      localStorage.setItem(PHOTO_STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // 容量超過やプライベートモード。保存できなくても操作は続けられる
    }
  });
}
