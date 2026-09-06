/**
 * アプリ全体の状態。
 * v4 の useRoomStore / useFurnitureStore / useUIStore 相当をひとつにまとめた。
 * 分ける必要が出たときに分ければよい。
 */

import { createStore } from '@/core/store';
import { ROOM_DEFAULT, type RoomSize } from '@/config/room';
import type { PlacedFurniture } from '@/config/furniture';

export interface AppState {
  room: RoomSize;
  furniture: PlacedFurniture[];
  /** 選択中の家具の ID。未選択なら null */
  selectedId: string | null;
}

export const appState = createStore<AppState>({
  room: { ...ROOM_DEFAULT },
  furniture: [],
  selectedId: null,
});

export function addFurniture(item: PlacedFurniture): void {
  appState.set((prev) => ({ furniture: [...prev.furniture, item] }));
}

export function removeFurniture(id: string): void {
  appState.set((prev) => ({
    furniture: prev.furniture.filter((f) => f.id !== id),
    selectedId: prev.selectedId === id ? null : prev.selectedId,
  }));
}

export function updateFurniture(id: string, patch: Partial<PlacedFurniture>): void {
  appState.set((prev) => ({
    furniture: prev.furniture.map((f) => (f.id === id ? { ...f, ...patch } : f)),
  }));
}

export function selectFurniture(id: string | null): void {
  appState.set({ selectedId: id });
}

/**
 * 新しい家具を置ける床の座標を探す。
 *
 * 全部を原点に置くと既存の家具に埋まって見えなくなるので、
 * 部屋の中央から外側へ向かって格子状に候補を試し、
 * 既存の家具と重ならない最初の場所を返す。
 * 空きが見つからない場合は中央に置く（重なっても操作は可能なため）。
 */
export function findFreePosition(size: [number, number, number]): [number, number, number] {
  const { room, furniture } = appState.get();
  const [width, , depth] = size;

  const STEP = 0.5; // 候補を探す間隔（メートル）
  const maxRings = Math.ceil(Math.max(room.width, room.depth) / 2 / STEP);

  for (let ring = 0; ring <= maxRings; ring++) {
    for (const [gridX, gridZ] of ringOffsets(ring)) {
      const x = gridX * STEP;
      const z = gridZ * STEP;

      // 家具が部屋からはみ出す候補は除外する
      if (Math.abs(x) + width / 2 > room.width / 2) continue;
      if (Math.abs(z) + depth / 2 > room.depth / 2) continue;

      const overlaps = furniture.some((other) =>
        isOverlapping(x, z, width, depth, other.position[0], other.position[2], other.size[0], other.size[2])
      );
      if (!overlaps) return [x, 0, z];
    }
  }

  return [0, 0, 0];
}

/** 中央から距離 ring にある格子点を列挙する（ring = 0 なら中央のみ） */
function ringOffsets(ring: number): Array<[number, number]> {
  if (ring === 0) return [[0, 0]];

  const offsets: Array<[number, number]> = [];
  for (let x = -ring; x <= ring; x++) {
    for (let z = -ring; z <= ring; z++) {
      // 内側の輪は前の ring で調べ済みなので、外周だけを見る
      if (Math.max(Math.abs(x), Math.abs(z)) === ring) offsets.push([x, z]);
    }
  }
  return offsets;
}

/** 2 つの家具を上から見た長方形として、重なっているかを判定する */
function isOverlapping(
  x1: number, z1: number, w1: number, d1: number,
  x2: number, z2: number, w2: number, d2: number
): boolean {
  return Math.abs(x1 - x2) < (w1 + w2) / 2 && Math.abs(z1 - z2) < (d1 + d2) / 2;
}
