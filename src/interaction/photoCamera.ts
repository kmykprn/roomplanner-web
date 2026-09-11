/**
 * 写真モードのカメラ。
 *
 * **いまは固定値で、写真に合わせてはいない。** 写真がどんなカメラで撮られたか
 * （画角・高さ・俯角）は画像から分からないので、立って部屋を見たときに近い値を
 * 置いてあるだけ。そのため置いたモデルは写真と遠近が揃わない。
 *
 * 合わせる操作（床の方眼を写真に重ねて調整する）は次の段階で入れる。
 * そのとき変わるのは**この4つの値の決め方だけ**で、カメラの組み立て方も
 * 家具のドラッグも変わらないように、値を1箇所にまとめてある。
 */

import * as THREE from 'three';

const PHOTO_CAMERA = {
  /** 画角（度）。スマホの標準的なカメラに近いあたり */
  fov: 50,
  /** 撮影者の目の高さ（m）。立って撮ったときのおおよそ */
  height: 1.5,
  /** 被写体までの距離（m） */
  distance: 4,
  /** 見ている高さ（m）。床より少し上を見て、やや見下ろす形にする */
  lookAtHeight: 0.4,
};

export function applyPhotoCamera(camera: THREE.PerspectiveCamera): void {
  camera.fov = PHOTO_CAMERA.fov;
  camera.position.set(0, PHOTO_CAMERA.height, PHOTO_CAMERA.distance);
  camera.lookAt(0, PHOTO_CAMERA.lookAtHeight, 0);
  camera.updateProjectionMatrix();
}
