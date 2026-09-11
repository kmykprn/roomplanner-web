/**
 * 部屋モードの状態。
 * v4 の useRoomStore / useFurnitureStore / useUIStore 相当をひとつにまとめた。
 *
 * 家具の出し入れそのものは写真モードと同じなので `core/furnitureScene.ts` に置いてある。
 * ここが持つのは**部屋モード固有のもの**、つまり部屋の大きさと、
 * 壁からはみ出させないための丸め方だけ。
 */

import { createStore } from '@/core/store';
import {
  createFurnitureScene,
  findFreeSpot,
  type FurnitureSceneState,
} from '@/core/furnitureScene';
import { ROOM_DEFAULT, type RoomSize } from '@/config/room';

export interface AppState extends FurnitureSceneState {
  room: RoomSize;
}

export const appState = createStore<AppState>({
  room: { ...ROOM_DEFAULT },
  furniture: [],
  selectedId: null,
});

/** 部屋モードの置き場。UI とドラッグ操作はこの形で受け取る */
export const roomScene = createFurnitureScene(appState, {
  placementFor: (size) => findFreePosition(size),
  constrain: (position, size, rotationY) =>
    clampInsideRoom(position, size, rotationY, appState.get().room),
});

/**
 * 家具が部屋からはみ出さない位置に丸める。
 *
 * 家具の中心を壁の位置で止めると、必ず半分が壁の外に出てしまう。
 * 家具の大きさの半分だけ内側で止める必要がある。
 *
 * 回転している家具は、上から見た輪郭（外接する長方形）が回転前より大きくなるので、
 * 回転後の大きさで計算する。
 */
function clampInsideRoom(
  position: [number, number, number],
  size: [number, number, number],
  rotationY: number,
  room: RoomSize
): [number, number, number] {
  const [halfX, halfZ] = rotatedHalfExtents(size, rotationY);

  // 家具が部屋より大きい場合は負になるため、0 で止めて中央に置く
  const limitX = Math.max(0, room.width / 2 - halfX);
  const limitZ = Math.max(0, room.depth / 2 - halfZ);

  // 高さは床で止める。写真モードには床が無いので、あちらは止めない
  return [
    Math.min(Math.max(position[0], -limitX), limitX),
    Math.max(position[1], 0),
    Math.min(Math.max(position[2], -limitZ), limitZ),
  ];
}

/**
 * 上から見た輪郭（外接する長方形）の、中心から端までの距離を返す。
 *
 * 幅 w・奥行き d の長方形を角度 θ 回すと、
 * 外接する長方形の半分の幅は |w/2·cosθ| + |d/2·sinθ| になる。
 */
function rotatedHalfExtents(
  size: [number, number, number],
  rotationY: number
): [number, number] {
  const halfWidth = size[0] / 2;
  const halfDepth = size[2] / 2;
  const cos = Math.abs(Math.cos(rotationY));
  const sin = Math.abs(Math.sin(rotationY));

  return [halfWidth * cos + halfDepth * sin, halfWidth * sin + halfDepth * cos];
}

/** 新しい家具を置ける床の座標を探す。部屋の壁の内側に限る */
function findFreePosition(size: [number, number, number]): [number, number, number] {
  const { room, furniture } = appState.get();
  return findFreeSpot(furniture, size, {
    limit: { halfWidth: room.width / 2, halfDepth: room.depth / 2 },
  });
}
