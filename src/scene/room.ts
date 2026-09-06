/**
 * 床と壁 4 枚を作る。
 *
 * 壁は「部屋の内側を向いた 1 枚のプレーン」。
 * 向きの定義は config/room.ts の getWallTransform に集約してある。
 */

import * as THREE from 'three';
import { WALL_DIRECTIONS, getWallTransform, type RoomSize, type WallDirection } from '@/config/room';
import { SCENE_COLORS, SURFACES } from '@/config/theme';

export interface RoomObjects {
  group: THREE.Group;
  floor: THREE.Mesh;
  /** 壁の可視性を切り替えるために方向で引けるようにしておく */
  walls: Record<WallDirection, THREE.Mesh>;
}

export function createRoom(size: RoomSize): RoomObjects {
  const group = new THREE.Group();

  const floor = createFloor(size);
  group.add(floor);

  const walls = {} as Record<WallDirection, THREE.Mesh>;
  for (const direction of WALL_DIRECTIONS) {
    const wall = createWall(direction, size);
    walls[direction] = wall;
    group.add(wall);
  }

  return { group, floor, walls };
}

function createFloor(size: RoomSize): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size.width, size.depth);
  const material = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.floor, ...SURFACES.floor });
  const floor = new THREE.Mesh(geometry, material);

  // PlaneGeometry は既定で XY 平面（+Z 向き）なので、床にするため X 軸まわりに -90 度倒す
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';

  return floor;
}

/**
 * 壁を作る。
 *
 * 壁だけは光の影響を受けない材質（MeshBasicMaterial）にしている。
 * 光を受ける材質だと、壁の向きごとに当たる光の量が変わるため
 * 指定した色より暗く、かつ 4 枚がばらばらの明るさになってしまう
 * （実測で指定色の 65〜80%、隣り合う壁どうしで 36 階調の差）。
 * 壁は部屋の色を決める面なので、指定した色がそのまま出るほうが扱いやすい。
 */
function createWall(direction: WallDirection, size: RoomSize): THREE.Mesh {
  const transform = getWallTransform(direction, size);

  const geometry = new THREE.PlaneGeometry(transform.planeWidth, size.height);
  const material = new THREE.MeshBasicMaterial({
    color: SCENE_COLORS.wall,
    // トーンマッピングも通さない。通すと露出の分だけ暗くなり、
    // 指定した色と描画結果がずれる
    toneMapped: false,
    // 透過アニメーションのために最初から transparent を有効にしておく。
    // 途中で切り替えるとマテリアルの再コンパイルが走ってカクつく
    transparent: true,
    opacity: 1,
  });

  const wall = new THREE.Mesh(geometry, material);
  wall.position.set(...transform.position);
  wall.rotation.y = transform.rotationY;
  wall.name = `wall-${direction}`;

  return wall;
}
