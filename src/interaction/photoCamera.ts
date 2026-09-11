/**
 * 写真モードのカメラ。
 *
 * 決めるべき値は `{ 画角・高さ・俯角・向き }` の4つ。
 * **床合わせが済んでいればその4つは計算で埋まる**（`core/photoCalibration.ts`）。
 * まだなら、立って部屋を見たときに近い固定値を置く。写真には合っていないので、
 * 置いたモデルは遠近が揃わない。
 */

import * as THREE from 'three';
import type { FloorCalibration } from '@/core/photoCalibration';

/** 床合わせをしていないときの見え方。立って撮ったときのおおよそ */
const DEFAULT_VIEW = {
  fov: 50,
  /** 撮影者の目の高さ（m） */
  height: 1.5,
  /** 被写体までの距離（m） */
  distance: 4,
  /** 見ている高さ（m）。床より少し上を見て、やや見下ろす形にする */
  lookAtHeight: 0.4,
};

/** 使い回して割り当てを減らす。毎フレームではないが、角のドラッグ中は連続で呼ばれる */
const basis = new THREE.Matrix4();
const axisRight = new THREE.Vector3();
const axisUp = new THREE.Vector3();
const axisBack = new THREE.Vector3();

export function applyPhotoCamera(
  camera: THREE.PerspectiveCamera,
  calibration: FloorCalibration | null
): void {
  if (!calibration) {
    camera.fov = DEFAULT_VIEW.fov;
    camera.position.set(0, DEFAULT_VIEW.height, DEFAULT_VIEW.distance);
    camera.lookAt(0, DEFAULT_VIEW.lookAtHeight, 0);
    camera.updateProjectionMatrix();
    return;
  }

  camera.fov = calibration.fov;
  camera.position.set(...calibration.position);

  // 3つの軸から向きを組む。回転として入れるので、three.js 側の行列更新は普段どおり動く
  axisRight.set(...calibration.right);
  axisUp.set(...calibration.up);
  axisBack.set(...calibration.back);
  camera.quaternion.setFromRotationMatrix(basis.makeBasis(axisRight, axisUp, axisBack));

  camera.updateProjectionMatrix();
}
