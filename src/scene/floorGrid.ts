/**
 * 床合わせに使う方眼。
 *
 * 合わせられているかは、**方眼が写真の床に貼り付いて見えるか**で判断してもらう。
 * カメラが合っていれば方眼は床の模様（フローリングの継ぎ目、タイルの目地）と
 * 平行に見え、合っていなければ浮いたり傾いたりして見える。
 *
 * ## 遠くほど薄くする理由
 *
 * 濃さが一様だと、壁や家具の上にも同じ強さで重なり、**床に乗っているのかどうかが
 * 見えない**。実際に「画面全体が方眼で埋まって判断できない」状態になった。
 * 手前を濃く、遠くを薄くすると、床に敷いてあるように見え、比べる相手（床の線）も
 * 隠れなくなる。
 */

import * as THREE from 'three';
import { CELL_METERS } from '@/core/floorView';
import { THEME } from '@/config/theme';

/**
 * 方眼の広さ（メートル四方）。
 *
 * 見ている場所を中心に敷くので、手前も奥も覆える広さが要る。
 * 狭いと、床を寝かせた（俯角が小さい）ときに手前が空いてしまう
 */
const EXTENT = 20;

/** 敷き紙の解像度。線がにじまない程度にとる */
const TEXTURE_SIZE = 1024;

export interface FloorGrid {
  object: THREE.Object3D;
  /** いま見ている場所へ移す。カメラの真下に置くと画面の外に出てしまう */
  setCenter(center: [number, number, number]): void;
}

export function createFloorGrid(): FloorGrid {
  const texture = new THREE.CanvasTexture(drawGrid());
  texture.colorSpace = THREE.SRGBColorSpace;
  // 床は浅い角度で見ることになる。これが無いと奥の方眼が潰れて線が消える
  texture.anisotropy = 8;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(EXTENT, EXTENT),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      // 床（y=0）に敷くので、家具より先に描いて奥行きは書かない。
      // 書くと、あとから描く家具の足元が方眼に負けて消える
      depthWrite: false,
    })
  );
  // PlaneGeometry は縦に立っているので、床へ倒す
  mesh.rotation.x = -Math.PI / 2;

  return {
    object: mesh,
    setCenter(center) {
      mesh.position.set(center[0], 0, center[2]);
    },
  };
}

/** 方眼を描いた敷き紙を作る。中心を濃く、外へ向かって薄くする */
function drawGrid(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;

  const context = canvas.getContext('2d');
  if (!context) return canvas;

  const cells = EXTENT / CELL_METERS;
  const pitch = TEXTURE_SIZE / cells;

  context.strokeStyle = THEME.primary;
  // 手前で見たときに太く見えすぎない太さ（1メモリが約2cmに相当する）
  context.lineWidth = 1.5;
  for (let i = 0; i <= cells; i++) {
    const position = Math.round(i * pitch) + 0.5;
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, TEXTURE_SIZE);
    context.moveTo(0, position);
    context.lineTo(TEXTURE_SIZE, position);
    context.stroke();
  }

  // 外へ向かって薄くする。destination-in なので、描いた線の濃さがそのまま削られる
  const half = TEXTURE_SIZE / 2;
  const fade = context.createRadialGradient(half, half, 0, half, half, half);
  fade.addColorStop(0, 'rgba(0,0,0,0.8)');
  fade.addColorStop(0.65, 'rgba(0,0,0,0.45)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');

  context.globalCompositeOperation = 'destination-in';
  context.fillStyle = fade;
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  return canvas;
}
