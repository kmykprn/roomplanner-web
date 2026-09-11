/**
 * 写真モードのカメラ。
 *
 * 床の見え方（`core/floorView.ts` の4つの値）から、そのまま組み立てる。
 * **割り出すのではなく、使う人が合わせた値をそのまま使う。**
 *
 * カメラは原点の真上に置き、向きだけを変える。床（y = 0）は動かさないので、
 * 家具の置き場も当たり判定も写真モードと部屋モードで同じままでいられる。
 */

import * as THREE from 'three';
import { FIXED_FOV, type FloorView } from '@/core/floorView';

export function applyPhotoCamera(camera: THREE.PerspectiveCamera, view: FloorView): void {
  camera.fov = FIXED_FOV;
  camera.position.set(0, view.height, 0);

  // YXZ の順に回すと、向き → 傾き → 水平 の順で効く。
  // この順でないと、傾けたあとの向きが斜めに回ってしまう
  camera.rotation.set(
    THREE.MathUtils.degToRad(-view.pitch),
    THREE.MathUtils.degToRad(view.yaw),
    THREE.MathUtils.degToRad(view.roll),
    'YXZ'
  );

  camera.updateProjectionMatrix();
}
