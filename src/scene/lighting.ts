/**
 * 部屋のライティング。v4 の RoomLighting 相当。
 */

import * as THREE from 'three';
import type { RoomSize } from '@/config/room';

export function createLighting(size: RoomSize): THREE.Group {
  const group = new THREE.Group();

  // 全体を均一に持ち上げる環境光
  group.add(new THREE.AmbientLight(0xffffff, 1.2));

  // 影を作る主光源。部屋の斜め上から
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(size.width, size.height * 2, size.depth);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);

  // 影の描画範囲を部屋のサイズに合わせる。
  // ここが狭いと家具の影が切れ、広すぎると影がぼやけるので部屋基準で決める
  const extent = Math.max(size.width, size.depth);
  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = -extent;
  shadowCamera.right = extent;
  shadowCamera.top = extent;
  shadowCamera.bottom = -extent;
  shadowCamera.near = 0.5;
  shadowCamera.far = extent * 4;
  shadowCamera.updateProjectionMatrix();

  group.add(sun);

  return group;
}
