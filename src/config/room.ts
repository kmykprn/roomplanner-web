/**
 * 部屋の 3D 座標系仕様
 *
 * 原点 (0, 0, 0) = 部屋の中央の床
 *   X 軸: 右が正、左が負
 *   Y 軸: 上が正、下が負（床が 0）
 *   Z 軸: 手前が正、奥が負
 *
 * すべての 3D オブジェクトは「底面基準」で作る。
 * つまり高さ h のオブジェクトは、メッシュを y = h/2 に置いて
 * グループの原点が底面に来るようにする。
 * こうしておくと配置時の Y 座標が「床からの高さ」そのものになる。
 */

export const ROOM_DEFAULT = {
  width: 6, // 幅（X 方向）m
  depth: 4, // 奥行き（Z 方向）m
  height: 2.5, // 天井高（Y 方向）m
} as const;

export type RoomSize = { width: number; depth: number; height: number };

/** 壁の方向。north = 奥、south = 手前、west = 左、east = 右 */
export const WALL_DIRECTIONS = ['north', 'south', 'west', 'east'] as const;
export type WallDirection = (typeof WALL_DIRECTIONS)[number];

export const WALL_LABELS: Record<WallDirection, string> = {
  north: '正面の壁',
  south: '手前の壁',
  west: '左の壁',
  east: '右の壁',
};

export interface WallTransform {
  /** 壁の中心座標 */
  position: readonly [number, number, number];
  /** Y 軸まわりの回転（ラジアン） */
  rotationY: number;
  /** 部屋の内側を向く法線 */
  normal: readonly [number, number, number];
  /** 壁の横幅。north/south は部屋の幅、west/east は奥行き */
  planeWidth: number;
}

/**
 * 壁ごとの配置情報を返す。
 *
 * normal は「部屋の内側を向く」ベクトル。
 * 壁が見えるかどうかの判定（interaction/wallVisibility.ts）は
 * この法線とカメラ位置の内積だけで決まるので、ここを唯一の定義元にする。
 */
export function getWallTransform(wall: WallDirection, size: RoomSize): WallTransform {
  const { width, depth, height } = size;
  const y = height / 2; // 壁の中心の高さ

  switch (wall) {
    case 'north':
      return {
        position: [0, y, -depth / 2] as const,
        rotationY: 0,
        normal: [0, 0, 1] as const,
        planeWidth: width,
      };
    case 'south':
      return {
        position: [0, y, depth / 2] as const,
        rotationY: Math.PI,
        normal: [0, 0, -1] as const,
        planeWidth: width,
      };
    case 'west':
      return {
        position: [-width / 2, y, 0] as const,
        rotationY: Math.PI / 2,
        normal: [1, 0, 0] as const,
        planeWidth: depth,
      };
    case 'east':
      return {
        position: [width / 2, y, 0] as const,
        rotationY: -Math.PI / 2,
        normal: [-1, 0, 0] as const,
        planeWidth: depth,
      };
  }
}
