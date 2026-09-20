/**
 * 写真モードのカメラ。
 *
 * **利用者がカメラを回すことはしない。** 写真は動かないので、カメラだけ自由に回ると嘘になる。
 * 動かすのは「写真を撮ったときの傾き」に合わせるときだけで、それが core/floorFit.ts の値。
 *
 * 高さは床から 1.4m の決め打ち。画角はここでは決めず、描画領域の高さに合わせて
 * viewer が持つ（core/viewer.ts）。
 */

import * as THREE from 'three';

import { CAMERA_HEIGHT, type FloorFit } from '@/core/floorFit';

/** 床（y = 0）の上に立つ位置。前後の位置は、家具を置く場所が画面に入るように取る */
const EYE_DISTANCE = 4;

/**
 * 写真モードのカメラを、床の傾きに合わせて置く。
 *
 * 回す順を YXZ にしているのは、**ロール（Z）を最後に掛ける**ため。
 * 先に掛けると、見下ろした分だけロールの軸まで傾いて、指の動きと画面の動きがずれる
 */
export function applyPhotoCamera(camera: THREE.PerspectiveCamera, fit: FloorFit): void {
  camera.position.set(0, CAMERA_HEIGHT, EYE_DISTANCE);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(
    THREE.MathUtils.degToRad(-fit.pitchDeg),
    0,
    THREE.MathUtils.degToRad(fit.rollDeg)
  );
  camera.updateProjectionMatrix();
}
