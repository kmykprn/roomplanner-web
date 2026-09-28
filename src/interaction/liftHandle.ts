/**
 * 選んだ家具の真上に出す、上下に動かすつまみ（↕）。
 *
 * 家具そのものをドラッグすると床の上を動く（画面の上へ動かすと奥へ進む）。棚の上の物や壁掛けの物を
 * 持ち上げたいときは、このつまみをドラッグする。**触る場所で動き方が決まる**ので、切り替えを置かずに済む。
 *
 * つまみは画面の上の要素（キャンバスの外）なので、キャンバスの家具のドラッグやカメラ操作とは取り合わない。
 * 位置は毎フレーム、家具の上面の真ん中を画面に写して決める。
 * 動かした分は、指で触れてから離すまでを 1 回の操作として履歴に残す（ひとつ戻す。core/editHistory.ts）。
 */

import * as THREE from 'three';
import type { EditableScene } from '@/core/furnitureScene';
import { beginEdit, endEdit } from '@/core/editHistory';

/** つまみを家具の上面からどれだけ上に出すか（CSS px） */
const GAP_ABOVE = 26;

export interface LiftHandleOptions {
  /** つまみを置く入れ物（キャンバスと同じ入れ物） */
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  /** いまのモードの家具の置き場 */
  scene(): EditableScene;
  /** つまみを出してよいか（背景の調整の最中などは出さない） */
  isEnabled(): boolean;
  /** どこまで下げられるか（m）。部屋は床（0）、写真は下限なし */
  lowest(): number;
  onFrame(callback: () => void): void;
}

export function createLiftHandle(options: LiftHandleOptions): void {
  const { container, canvas, camera } = options;
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'lift-handle';
  handle.setAttribute('aria-label', '家具を上下に動かす');
  handle.textContent = '↕';
  handle.hidden = true;
  container.append(handle);

  const top = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();

  /** 掴んでいる間の情報。掴んでいなければ null */
  let drag: { scene: EditableScene; id: string; startY: number; startHitY: number } | null = null;

  function selected(scene: EditableScene) {
    const { selectedId, furniture } = scene.state();
    return furniture.find((item) => item.id === selectedId) ?? null;
  }

  /** 毎フレーム、家具の上面の真ん中の少し上に置く。写らない（カメラの後ろ）なら隠す */
  options.onFrame(() => {
    const item = options.isEnabled() ? selected(options.scene()) : null;
    if (!item) {
      handle.hidden = true;
      return;
    }
    top.set(item.position[0], item.position[1] + item.size[1], item.position[2]).project(camera);
    if (top.z > 1) {
      handle.hidden = true;
      return;
    }
    const x = canvas.offsetLeft + ((top.x + 1) / 2) * canvas.clientWidth;
    const y = canvas.offsetTop + ((1 - top.y) / 2) * canvas.clientHeight - GAP_ABOVE;
    handle.hidden = false;
    handle.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  });

  /** 指の位置の視線と、家具を通りカメラの方を向く縦の面との交点の高さ */
  function heightAt(event: PointerEvent, through: THREE.Vector3): number | null {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    // 面の向きは、カメラの向きを水平にしたもの（縦の面にする）
    const facing = new THREE.Vector3();
    camera.getWorldDirection(facing);
    facing.y = 0;
    if (facing.lengthSq() < 1e-8) return null;
    plane.setFromNormalAndCoplanarPoint(facing.normalize(), through);
    return raycaster.ray.intersectPlane(plane, hit) ? hit.y : null;
  }

  handle.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary) return;
    const scene = options.scene();
    const item = selected(scene);
    if (!item) return;
    const startHitY = heightAt(event, new THREE.Vector3(...item.position));
    if (startHitY === null) return;
    event.preventDefault();
    // 指がつまみの外へ出ても追えるように掴む。掴めなくても（その指がもう無いなど）動かすことはできる
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // 何もしない
    }
    beginEdit(scene);
    drag = { scene, id: item.id, startY: item.position[1], startHitY };
  });

  handle.addEventListener('pointermove', (event) => {
    if (!drag || !event.isPrimary) return;
    const item = drag.scene.state().furniture.find((entry) => entry.id === drag?.id);
    if (!item) return;
    const y = heightAt(event, new THREE.Vector3(...item.position));
    if (y === null) return;
    const next = Math.max(options.lowest(), drag.startY + (y - drag.startHitY));
    drag.scene.update(item.id, {
      position: drag.scene.constrain([item.position[0], next, item.position[2]], item.size, item.rotationY),
    });
  });

  for (const type of ['pointerup', 'pointercancel'] as const) {
    handle.addEventListener(type, () => {
      if (!drag) return;
      endEdit(drag.scene);
      drag = null;
    });
  }
}
