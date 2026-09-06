/**
 * カメラの位置に応じて、手前側の壁を自動的に透過させる。
 *
 * roomplanner-v4 の utils/wallVisibilitySystem.ts（283 行）の置き換え。
 * v4 では React に伝えるためにカメラの球面座標から位置を毎回再計算していたが、
 * three.js を直接使えば camera.position が既に答えなので、
 * 「壁の法線と、壁からカメラへ向かうベクトルの内積」だけで判定できる。
 *
 *   内積 > 0  → カメラは壁の内側（部屋の中）にいる → 壁を表示
 *   内積 <= 0 → カメラは壁の外側にいる → 壁を透過（部屋の中が見える）
 */

import * as THREE from 'three';
import { WALL_DIRECTIONS, getWallTransform, type RoomSize, type WallDirection } from '@/config/room';

/** 透過しきった壁の不透明度。完全な 0 にせず輪郭を薄く残す */
const HIDDEN_OPACITY = 0.05;

/** 1 フレームあたりの不透明度の変化量。小さいほどゆっくり切り替わる */
const FADE_SPEED = 0.12;

interface WallProbe {
  material: THREE.MeshStandardMaterial;
  position: THREE.Vector3;
  normal: THREE.Vector3;
}

export function createWallVisibility(
  walls: Record<WallDirection, THREE.Mesh>,
  camera: THREE.Camera,
  size: RoomSize
) {
  // 壁の位置と法線は部屋のサイズが変わらない限り不変なので、
  // 毎フレーム作り直さず最初に 1 度だけ用意する
  const probes: WallProbe[] = WALL_DIRECTIONS.map((direction) => {
    const transform = getWallTransform(direction, size);
    return {
      material: walls[direction].material as THREE.MeshStandardMaterial,
      position: new THREE.Vector3(...transform.position),
      normal: new THREE.Vector3(...transform.normal),
    };
  });

  const wallToCamera = new THREE.Vector3();

  return function update(): void {
    for (const probe of probes) {
      wallToCamera.subVectors(camera.position, probe.position);
      const target = wallToCamera.dot(probe.normal) > 0 ? 1 : HIDDEN_OPACITY;

      // 一気に切り替えるとチラつくので、目標値へ少しずつ近づける
      probe.material.opacity += (target - probe.material.opacity) * FADE_SPEED;
    }
  };
}
