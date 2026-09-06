/**
 * 部屋のライティング。
 *
 * 環境光マップ（core/viewer.ts の scene.environment）が
 * 「周囲から回り込む光」を担当するので、ここでは
 * 「窓から差し込む主光源」と「影の側を持ち上げる補助光」だけを置く。
 * AmbientLight を強く入れると環境光と二重になって陰影が消えるため使わない。
 *
 * 主光源の位置はカメラの初期方向を避けて決めている（createSunlight のコメント参照）。
 */

import * as THREE from 'three';
import type { RoomSize } from '@/config/room';

export function createLighting(size: RoomSize): THREE.Group {
  const group = new THREE.Group();

  group.add(createSunlight(size));

  // 影の側が沈みすぎないよう、主光源の反対側から弱く当てる。
  // 影を作らないので描画コストはほぼ増えない
  const fill = new THREE.DirectionalLight(0xdce6f0, 0.5);
  fill.position.set(size.width, size.height, size.depth);
  group.add(fill);

  return group;
}

/** 窓から差し込む想定の主光源。影を落とすのはこの 1 灯だけ */
function createSunlight(size: RoomSize): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.6);
  // 左奥の上から当てる。
  // カメラの初期位置（右手前の上）と光源の向きが揃っていると、
  // それぞれの影が自分自身の真後ろに隠れて見えなくなるため、意図的にずらしている
  sun.position.set(-size.width * 0.8, size.height * 2.4, -size.depth * 0.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);

  // 影のちらつき（面が自分自身の影を拾う現象）を抑える補正。
  // 大きくすると影が本体から離れて浮いて見えるので、必要最小限にする
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;

  // 影の描画範囲を部屋の大きさに合わせる。
  // 狭いと家具の影が切れ、広すぎると同じ解像度を広い範囲に配るのでぼやける
  const extent = Math.max(size.width, size.depth);
  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = -extent;
  shadowCamera.right = extent;
  shadowCamera.top = extent;
  shadowCamera.bottom = -extent;
  shadowCamera.near = 0.5;
  shadowCamera.far = extent * 6;
  shadowCamera.updateProjectionMatrix();

  return sun;
}
