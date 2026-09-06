/**
 * 家具のタップ選択とドラッグ移動。
 * v4 の useFurnitureInteraction.ts + usePointerGesture の置き換え。
 *
 * 流れは 1 本道になっている:
 *   押した   → 指の下に家具があるか調べる。あればカメラ操作を止めて掴む
 *   動かした → 指の位置を床平面に投影し、その座標へ家具を動かす
 *   離した   → ほとんど動いていなければ「タップ」とみなして選択を切り替える
 *
 * いずれも 1 本目の指だけを見る。2 本目以降はカメラ操作に渡す。
 */

import * as THREE from 'three';
import type { CameraControls } from '@/interaction/cameraControls';
import type { FurnitureLayer } from '@/scene/furniture';
import { appState, clampInsideRoom, selectFurniture, updateFurniture } from '@/core/appState';

/** この距離（ピクセル）以内で指を離したらドラッグではなくタップとみなす */
const TAP_THRESHOLD_PX = 8;

export function createFurnitureDrag(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  layer: FurnitureLayer,
  cameraControls: CameraControls
): () => void {
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  // 家具は床の上を滑る。y = 0 の水平面に指の位置を投影して移動先を決める
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();

  let draggingId: string | null = null;
  /** 掴んだ点と家具の原点のズレ。これを保たないと家具が指の中心に飛ぶ */
  let grabOffset = new THREE.Vector3();
  let pressPosition = { x: 0, y: 0 };

  /** 画面座標を -1..1 の正規化デバイス座標へ変換する */
  function toNdc(event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function onPointerDown(event: PointerEvent): void {
    // 2 本指以降はカメラ操作なので、家具の掴みは 1 本目だけ受け付ける
    if (!event.isPrimary) return;

    pressPosition = { x: event.clientX, y: event.clientY };
    toNdc(event);
    raycaster.setFromCamera(pointerNdc, camera);

    const hits = raycaster.intersectObjects(layer.pickables(), false);
    if (hits.length === 0) return;

    const furnitureId = hits[0].object.userData.furnitureId as string | undefined;
    if (!furnitureId) return;

    draggingId = furnitureId;
    cameraControls.enabled = false; // 家具を動かしている間はカメラを固定する

    const item = appState.get().furniture.find((f) => f.id === furnitureId);
    if (item && raycaster.ray.intersectPlane(floorPlane, hitPoint)) {
      grabOffset = new THREE.Vector3(...item.position).sub(hitPoint);
    }
  }

  function onPointerMove(event: PointerEvent): void {
    // 家具を動かすのは 1 本目の指だけ。
    // これがないと、家具を掴んだまま 2 本目の指を置いたとき、
    // カメラ操作のつもりの動きで家具のほうが動いてしまう
    if (!event.isPrimary) return;
    if (!draggingId) return;

    toNdc(event);
    raycaster.setFromCamera(pointerNdc, camera);
    if (!raycaster.ray.intersectPlane(floorPlane, hitPoint)) return;

    const next = hitPoint.add(grabOffset);
    const { room, furniture } = appState.get();
    const item = furniture.find((f) => f.id === draggingId);
    if (!item) return;

    // 家具の大きさと向きを見て、壁からはみ出さない位置に丸める
    updateFurniture(draggingId, {
      position: clampInsideRoom([next.x, 0, next.z], item.size, item.rotationY, room),
    });
  }

  function onPointerUp(event: PointerEvent): void {
    if (!event.isPrimary) return;

    const movedDistance = Math.hypot(
      event.clientX - pressPosition.x,
      event.clientY - pressPosition.y
    );

    if (movedDistance < TAP_THRESHOLD_PX) {
      // 家具の上ならその家具を選択、何もない場所なら選択解除
      const { selectedId } = appState.get();
      selectFurniture(draggingId === selectedId ? null : draggingId);
    }

    draggingId = null;
    cameraControls.enabled = true;
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
