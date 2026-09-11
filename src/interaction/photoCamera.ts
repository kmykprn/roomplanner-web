/**
 * 写真モードのカメラ。
 *
 * **動かさない。** 合わせるのは床のほうで（`core/floorTransform.ts`）、
 * カメラは原点で正面を向いたまま置いておく。
 *
 * こうすると、床をつかんで動かすギズモがそのまま使える。
 * カメラを動かす作りだと「床を上下に動かす」を表せなかった
 * （床の上下と、カメラの高さ＝縮尺が区別できないため）。
 */

import * as THREE from 'three';
import { FIXED_FOV } from '@/core/floorTransform';

export function applyPhotoCamera(camera: THREE.PerspectiveCamera): void {
  camera.fov = FIXED_FOV;
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);
  camera.updateProjectionMatrix();
}
