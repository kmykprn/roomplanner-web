/**
 * 写真の上で、指で方眼を動かす。
 *
 *   1本指ドラッグ … 方眼そのものを床の上で滑らせる（つかんで動かす）
 *   2本指ピンチ   … 1マスの見かけの大きさ
 *   2本指ひねり   … 水平（写真の傾き）
 *
 * **傾きと向きはボタン側にある**（`ui/alignPanel.ts`）。1本指は「方眼をつかんで
 * 動かす」に使うほうが直接的なので、そちらへ譲っている。
 *
 * 動くのは「床」タブを開いている間だけ。開いていない間は家具のドラッグに譲る。
 */

import * as THREE from 'three';
import { adjustFloorView, photoState } from '@/core/photoState';

export function createFloorGesture(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera
): () => void {
  /** 画面に触れている指。2本指の判定に使う */
  const pointers = new Map<number, { x: number; y: number }>();

  /** 2本指の前回の間隔と角度。1本目の move では基準を取るだけ */
  let previousSpread = 0;
  let previousAngle: number | null = null;

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();

  /** 指が触れている床の位置。地平線より上を指していれば null */
  function floorPointAt(x: number, y: number): THREE.Vector3 | null {
    const bounds = canvas.getBoundingClientRect();
    pointerNdc.x = ((x - bounds.left) / bounds.width) * 2 - 1;
    pointerNdc.y = -((y - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    return raycaster.ray.intersectPlane(floorPlane, hitPoint) ? hitPoint : null;
  }

  function isActive(): boolean {
    return photoState.get().isAligning;
  }

  function onPointerDown(event: PointerEvent): void {
    if (!isActive()) return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // 指の本数が変わったら、ピンチとひねりの基準を取り直す
    previousSpread = 0;
    previousAngle = null;
  }

  function onPointerMove(event: PointerEvent): void {
    const previous = pointers.get(event.pointerId);
    if (!previous || !isActive()) return;

    const from = { x: previous.x, y: previous.y };
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      slide(from, { x: event.clientX, y: event.clientY });
    } else if (pointers.size === 2) {
      pinchAndTwist();
    }
  }

  function onPointerUp(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    previousSpread = 0;
    previousAngle = null;
  }

  /**
   * 1本指。指の下の床が動いたぶんだけ方眼を動かす。
   *
   * 画面の移動量をそのまま使わず**床の上で測る**のは、手前と奥で
   * 1ピクセルの意味が変わるため。指につかんだ場所がついてくる動きになる
   */
  function slide(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const before = floorPointAt(from.x, from.y)?.clone();
    if (!before) return;
    const after = floorPointAt(to.x, to.y);
    if (!after) return;

    const { floorView } = photoState.get();
    adjustFloorView({
      offsetX: floorView.offsetX + (after.x - before.x),
      offsetZ: floorView.offsetZ + (after.z - before.z),
    });
  }

  /** 2本指。間隔で大きさ、角度で水平を変える */
  function pinchAndTwist(): void {
    const [a, b] = [...pointers.values()];
    const spread = Math.hypot(a.x - b.x, a.y - b.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);

    const { floorView } = photoState.get();
    const patch: { height?: number; roll?: number } = {};

    if (previousSpread > 0 && spread > 0) {
      // 指を広げるとマス目が大きくなる＝床に近づく＝目線が下がる
      patch.height = floorView.height * (previousSpread / spread);
    }
    if (previousAngle !== null) {
      let turned = angle - previousAngle;
      // −π と π をまたぐときに一周ぶん飛ぶのを防ぐ
      if (turned > Math.PI) turned -= Math.PI * 2;
      if (turned < -Math.PI) turned += Math.PI * 2;
      patch.roll = floorView.roll + (turned * 180) / Math.PI;
    }

    if (patch.height !== undefined || patch.roll !== undefined) adjustFloorView(patch);

    previousSpread = spread;
    previousAngle = angle;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  return function dispose(): void {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
  };
}
