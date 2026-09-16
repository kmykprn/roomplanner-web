/**
 * 床と壁 4 枚を作る。
 *
 * 壁は「部屋の内側を向いた 1 枚のプレーン」。
 * 向きの定義は config/room.ts の getWallTransform に集約してある。
 */

import * as THREE from 'three';
import { WALL_DIRECTIONS, getWallTransform, type RoomSize, type WallDirection } from '@/config/room';
import { SCENE_COLORS, SURFACES } from '@/config/theme';
import type { InteriorTextures } from '@/scene/interiorTextures';

export interface RoomObjects {
  group: THREE.Group;
  floor: THREE.Mesh;
  /** 壁の可視性を切り替えるために方向で引けるようにしておく */
  walls: Record<WallDirection, THREE.Mesh>;
  /** 部屋の大きさを変える（和室は畳数で大きさが決まる）。メッシュは作り直さず形だけ差し替える */
  resize(size: RoomSize): void;
  /** 内装の柄を床と壁に貼る */
  applyInterior(textures: InteriorTextures): void;
}

export function createRoom(initialSize: RoomSize): RoomObjects {
  const group = new THREE.Group();
  let size = initialSize;

  const floor = createFloor(size);
  group.add(floor);

  const walls = {} as Record<WallDirection, THREE.Mesh>;
  for (const direction of WALL_DIRECTIONS) {
    const wall = createWall(direction, size);
    walls[direction] = wall;
    group.add(wall);
  }

  function resize(next: RoomSize): void {
    size = next;
    floor.geometry.dispose();
    floor.geometry = new THREE.PlaneGeometry(size.width, size.depth);
    for (const direction of WALL_DIRECTIONS) {
      const wall = walls[direction];
      const transform = getWallTransform(direction, size);
      wall.geometry.dispose();
      wall.geometry = new THREE.PlaneGeometry(transform.planeWidth, size.height);
      wall.position.set(...transform.position);
      const edges = wall.getObjectByName('edges') as THREE.LineSegments | undefined;
      if (edges) {
        edges.geometry.dispose();
        edges.geometry = new THREE.EdgesGeometry(wall.geometry);
      }
    }
  }

  function applyInterior(textures: InteriorTextures): void {
    const floorMaterial = floor.material as THREE.MeshStandardMaterial;
    floorMaterial.map?.dispose();
    floorMaterial.map = textures.floor;
    floorMaterial.color.set('#ffffff');
    floorMaterial.needsUpdate = true;

    for (const direction of WALL_DIRECTIONS) {
      const wall = walls[direction];
      const material = wall.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      // 壁ごとに横幅が違うので、繰り返しの回数も壁ごとに決める（絵は同じ 1 枚）
      const texture = new THREE.CanvasTexture(textures.wall);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(getWallTransform(direction, size).planeWidth / textures.wallTileWidth, 1);
      texture.anisotropy = 8;
      material.map = texture;
      material.color.set('#ffffff');
      material.needsUpdate = true;
    }
  }

  return { group, floor, walls, resize, applyInterior };
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

  // 光の影響をなくしたぶん、壁どうしの境目（部屋の角）と床際が見えなくなる。
  // 輪郭線で補う。壁の子にしてあるので、壁と一緒に動く
  wall.add(createWallEdges(geometry));

  return wall;
}

/**
 * 壁の外周をなぞる線。
 *
 * 4 辺すべてを引くので、隣り合う壁との境目・床際・天井際が同時に出る。
 * 角では隣の壁の線と重なるが、同じ位置なので見た目には 1 本に見える。
 */
function createWallEdges(wallGeometry: THREE.PlaneGeometry): THREE.LineSegments {
  const material = new THREE.LineBasicMaterial({
    color: SCENE_COLORS.wallEdge,
    // 壁と同じ扱いにする。光もトーンマッピングも通さない
    toneMapped: false,
    transparent: true,
    opacity: 1,
  });

  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(wallGeometry), material);
  edges.name = 'edges';

  // 壁とまったく同じ位置だと線が壁に埋もれてちらつくため、
  // ごくわずかに部屋の内側へ浮かせる
  edges.position.z = 0.002;

  // さらに、外周をほんの少し内側へ縮める。
  // 縮めないと角の縦線が隣の壁とちょうど同じ平面に乗ってしまい、
  // どちらを手前に描くか定まらず線が途切れて見える
  edges.scale.set(0.998, 0.998, 1);

  return edges;
}
