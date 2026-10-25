/**
 * 写真モードのカメラ。
 *
 * **利用者がカメラを回すことはしない。** 写真は動かないので、カメラだけ自由に回ると嘘になる。
 * 動かすのは「写真を撮ったときの傾き」に合わせるときだけで、それが core/floorFit.ts の値。
 *
 * 高さは立って撮った高さ（1.4 m）。画角はここでは決めず viewer が持つ（core/viewer.ts）。
 *
 * **家具はカメラに正対する面の上に置く。** 写真の奥行きには合わせない。面はカメラから一定の距離にあり、
 * 家具を画面の上下に動かしても奥へ行かず、写る大きさは変わらない（大きさは利用者がボタンで決める）
 */

import * as THREE from 'three';

import type { FloorFit } from '@/core/floorFit';

/** 床（y = 0）の上に立つ位置。前後の位置は、家具を置く場所が画面に入るように取る */
export const EYE_DISTANCE = 4;

/** 家具を置く面までの距離（m）。カメラの正面にこれだけ離れた、カメラに正対する面に置く */
export const PLACEMENT_DISTANCE = 4;

/**
 * 写真モードのカメラを、床の傾きに合わせて置く。
 *
 * 回す順を YXZ にしているのは、**ロール（Z）を最後に掛ける**ため。
 * 先に掛けると、見下ろした分だけロールの軸まで傾いて、指の動きと画面の動きがずれる
 */
export function applyPhotoCamera(camera: THREE.PerspectiveCamera, fit: FloorFit, height: number): void {
  camera.position.set(0, height, EYE_DISTANCE);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(
    THREE.MathUtils.degToRad(-fit.pitchDeg),
    0,
    THREE.MathUtils.degToRad(fit.rollDeg)
  );
  camera.updateProjectionMatrix();
}

const raycaster = new THREE.Raycaster();

/** カメラの正面の向き（単位ベクトル）。回したばかりのカメラでも正しい向きになるよう、行列を更新してから取る */
function forwardOf(camera: THREE.Camera): THREE.Vector3 {
  camera.updateMatrixWorld(true);
  return camera.getWorldDirection(new THREE.Vector3());
}

/** その点を通り、カメラに正対する面。家具を指で動かすとき、この面の上を滑らせる */
export function viewPlaneThrough(camera: THREE.Camera, point: THREE.Vector3): THREE.Plane {
  return new THREE.Plane().setFromNormalAndCoplanarPoint(forwardOf(camera), point);
}

/**
 * 画面の点（NDC、-1〜1）の視線が、カメラから distance 先のカメラに正対する面と交わる位置。
 * 新しい家具を置く場所に使う。視線が面と交わらないことは無い（面は視線の正面にある）
 */
export function pointOnViewPlane(camera: THREE.Camera, x: number, y: number, distance: number): THREE.Vector3 | null {
  const forward = forwardOf(camera);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(forward, camera.position.clone().addScaledVector(forward, distance));
  raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
}

/**
 * 高さ height の物が足元 position に立つとき、画面の高さのどれだけを占めるか（0〜1）。
 * 置いたときに大きすぎないよう縮めるのに使う。写らない（カメラの後ろ）なら null
 */
export function screenHeightShare(camera: THREE.Camera, position: [number, number, number], height: number): number | null {
  camera.updateMatrixWorld(true);
  const foot = new THREE.Vector3(...position).project(camera);
  const top = new THREE.Vector3(position[0], position[1] + height, position[2]).project(camera);
  if (foot.z > 1 || top.z > 1) return null;
  return Math.abs(top.y - foot.y) / 2;
}
