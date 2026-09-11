/**
 * 写真モードのカメラ。
 *
 * **動かさない。** 部屋を立って撮ったときに近い高さ・距離に置いたまま固定する。
 *
 * 写真は動かないので、カメラだけ回ると嘘になる。使う人には画角も高さも出さず、
 * 「写真の上に家具を置く」ことだけに絞ってある。
 */

import * as THREE from 'three';

/** 画角（度）。使う人には出さない */
const FIXED_FOV = 50;

/** 床（y = 0）を見下ろす目の位置。立って部屋を撮ったときに近いあたり */
const EYE_HEIGHT = 1.4;
const EYE_DISTANCE = 4;

export function applyPhotoCamera(camera: THREE.PerspectiveCamera): void {
  camera.fov = FIXED_FOV;
  camera.position.set(0, EYE_HEIGHT, EYE_DISTANCE);
  // 正面を向いたまま。傾けると床の水平が写真と合わなくなる
  camera.rotation.set(0, 0, 0);
  camera.updateProjectionMatrix();
}
