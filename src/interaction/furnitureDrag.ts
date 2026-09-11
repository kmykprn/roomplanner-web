/**
 * 家具のタップ選択とドラッグ移動。
 * v4 の useFurnitureInteraction.ts + usePointerGesture の置き換え。
 *
 * 流れは 1 本道になっている:
 *   押した   → 指の下に家具があるか調べる。あればカメラ操作を止めて掴む
 *   動かした → 指の位置を床平面に投影し、その座標へ家具を動かす
 *   離した   → ほとんど動いていなければ「タップ」とみなして選択を切り替える
 *
 * いずれも 1 本目の指だけを見る。**2 本目の指が触れたら家具からは手を離し**、
 * 見る操作（カメラ／写真に寄る）に渡す。
 */

import * as THREE from 'three';
import type { CameraControls } from '@/interaction/cameraControls';
import type { FurnitureLayer } from '@/scene/furniture';
import type { EditableScene } from '@/core/furnitureScene';

/** この距離（ピクセル）以内で指を離したらドラッグではなくタップとみなす */
const TAP_THRESHOLD_PX = 8;

/** 操作の対象。モードで入れ替わるので、その都度引き直す */
export interface DragTarget {
  scene: EditableScene;
  layer: FurnitureLayer;
}

export function createFurnitureDrag(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  // 部屋と写真でシーンも3Dのレイヤーも変わる。掴んだ時点のものを使う
  resolveTarget: () => DragTarget,
  cameraControls: CameraControls
): () => void {
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  // 家具は床の上を滑る。y = 0 の水平面に指の位置を投影して移動先を決める
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();

  /**
   * 画面に触れている指。本数だけを見る。
   *
   * 2 本になったら家具からは手を離す。これが無いと、寄るつもりのピンチで
   * 1 本目の指の下にあった家具まで一緒に動いてしまう
   */
  const activePointers = new Set<number>();

  let draggingId: string | null = null;
  /** 掴んでいる間だけ対象を保持する。途中でモードが変わっても操作が迷子にならない */
  let draggingTarget: DragTarget | null = null;
  /** 掴む前のカメラ操作の可否。離したときにここへ戻す */
  let cameraWasEnabled = true;
  /** 掴んだ点と家具の原点のズレ。これを保たないと家具が指の中心に飛ぶ */
  let grabOffset = new THREE.Vector3();
  let pressPosition = { x: 0, y: 0 };

  /** 画面座標を -1..1 の正規化デバイス座標へ変換する */
  function toNdc(event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** 掴んでいるものを放し、カメラ操作を掴む前の状態へ戻す */
  function releaseDrag(): void {
    if (!draggingId) return;
    draggingId = null;
    draggingTarget = null;
    cameraControls.enabled = cameraWasEnabled;
  }

  function onPointerDown(event: PointerEvent): void {
    activePointers.add(event.pointerId);

    // 2 本目が触れた時点で見る操作に渡す。掴んでいたものはここで放す
    if (activePointers.size > 1) {
      releaseDrag();
      return;
    }

    pressPosition = { x: event.clientX, y: event.clientY };
    toNdc(event);
    raycaster.setFromCamera(pointerNdc, camera);

    const target = resolveTarget();
    const hits = raycaster.intersectObjects(target.layer.pickables(), false);
    if (hits.length === 0) return;

    const furnitureId = hits[0].object.userData.furnitureId as string | undefined;
    if (!furnitureId) return;

    draggingId = furnitureId;
    draggingTarget = target;

    // 家具を動かしている間はカメラを固定する。
    // **戻すのは true ではなく元の値。** 写真モードはカメラ操作を止めてあるので、
    // 決め打ちで true に戻すと、家具を1度掴んだだけで動くようになってしまう
    cameraWasEnabled = cameraControls.enabled;
    cameraControls.enabled = false;

    const item = target.scene.state().furniture.find((f) => f.id === furnitureId);
    if (item && raycaster.ray.intersectPlane(floorPlane, hitPoint)) {
      grabOffset = new THREE.Vector3(...item.position).sub(hitPoint);
    }
  }

  function onPointerMove(event: PointerEvent): void {
    // 家具を動かすのは 1 本目の指だけ。
    // 掴んだ時点で 2 本目が来れば上で放しているが、そもそも 2 本目の動きは見ない
    if (!event.isPrimary) return;
    if (!draggingId || !draggingTarget) return;

    toNdc(event);
    raycaster.setFromCamera(pointerNdc, camera);
    if (!raycaster.ray.intersectPlane(floorPlane, hitPoint)) return;

    const next = hitPoint.add(grabOffset);
    const { scene } = draggingTarget;
    const item = scene.state().furniture.find((f) => f.id === draggingId);
    if (!item) return;

    // 移動先の丸め方はモードが決める（部屋なら壁の内側、写真なら丸めない）
    scene.update(draggingId, {
      position: scene.constrain([next.x, 0, next.z], item.size, item.rotationY),
    });
  }

  function onPointerUp(event: PointerEvent): void {
    // 2 本目が触れていたなら、それは見る操作だった。選択は切り替えない
    const wasOnlyFinger = activePointers.size === 1;
    activePointers.delete(event.pointerId);
    if (!event.isPrimary) return;

    const movedDistance = Math.hypot(
      event.clientX - pressPosition.x,
      event.clientY - pressPosition.y
    );

    if (wasOnlyFinger && movedDistance < TAP_THRESHOLD_PX) {
      // 家具の上ならその家具を選択、何もない場所なら選択解除
      const scene = draggingTarget?.scene ?? resolveTarget().scene;
      const { selectedId } = scene.state();
      scene.select(draggingId === selectedId ? null : draggingId);
    }

    releaseDrag();
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
