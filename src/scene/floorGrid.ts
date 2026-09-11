/**
 * 床合わせに使う方眼。
 *
 * 合わせられているかどうかは、**方眼が写真の床に貼り付いて見えるか**で判断する。
 * カメラが正しければ方眼は床の模様（フローリングの継ぎ目、タイルの目地）と
 * 平行に見え、間違っていれば浮いたり傾いたりして見える。
 */

import * as THREE from 'three';
import { THEME } from '@/config/theme';

/** 方眼の広さ（メートル四方）。部屋1つが収まる程度あればよい */
const EXTENT = 10;

/** 1マスの大きさ（メートル）。既知の物（ドア幅80cm・畳）と比べやすい大きさにする */
const CELL = 0.5;

/** 合わせられないときの色。写真の上でも沈んで見えるグレー */
const INVALID_COLOR = '#9aa5aa';

export interface FloorGrid {
  object: THREE.Object3D;
  /** 合わせられている間は主色、解けないときはグレーにする */
  setValid(valid: boolean): void;
}

export function createFloorGrid(): FloorGrid {
  const grid = new THREE.GridHelper(EXTENT, EXTENT / CELL);

  const material = grid.material as THREE.LineBasicMaterial;
  // GridHelper は既定で線ごとに色を持つ。1色で塗り替えるために切っておく
  material.vertexColors = false;
  material.transparent = true;
  material.opacity = 0.55;
  // 床（y=0）に置くので、写真の床の上に重なる
  material.depthWrite = false;

  function setValid(valid: boolean): void {
    material.color.set(valid ? THEME.primary : INVALID_COLOR);
  }

  setValid(true);
  return { object: grid, setValid };
}
