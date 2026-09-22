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

/** 床の平面（y = 0）。写真モードの家具はすべてこの上に立つ */
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();

/**
 * 画面のある点（NDC、-1〜1）に見えている床の位置。床より上を向いていれば null。
 *
 * 見下ろし角と画角が写真に合っていれば、この点までの距離は
 * 「カメラの高さ ÷ tan(地平線からの角度)」で決まる実際の距離になる。
 * 決まらないのはカメラの高さ（CAMERA_HEIGHT の仮定）だけ
 */
export function floorPointOnScreen(
  camera: THREE.Camera,
  x: number,
  y: number
): THREE.Vector3 | null {
  // 回したばかりのカメラは行列に反映されていないことがある（scene/floorMarkers.ts と同じ理由）
  camera.updateMatrixWorld(true);
  raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(FLOOR, hit) ? hit : null;
}
