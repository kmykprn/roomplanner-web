/**
 * 写真に寄る操作。
 *
 *   2 本指ピンチ  … 寄る / 引く
 *   2 本指ドラッグ … 寄ったまま見る場所をずらす
 *
 * **1 本目の指は家具のドラッグに残す**（`interaction/furnitureDrag.ts`）。
 * 指が 2 本そろったときだけ動くので、置く操作と取り合いにならない。
 *
 * 寄るのは写真だけではない。3D も同じ矩形に切り取られるので、
 * 家具は写真の同じ場所に貼り付いたまま一緒に大きくなる（`core/viewer.ts`）。
 */

import { photoState, setPhotoView } from '@/core/photoState';
import { clampScale, photoPointAt, viewAnchoredAt, type ScreenPoint } from '@/core/photoView';

export function createPhotoZoom(
  canvas: HTMLCanvasElement,
  /** 写真モードを開いている間だけ効かせる */
  isEnabled: () => boolean
): () => void {
  /** 画面に触れている指。2 本そろってから動かす */
  const pointers = new Map<number, ScreenPoint>();

  /** 直前の 2 本指の状態。ここからの変化で倍率とずらし量を出す */
  let previous: { distance: number; middle: ScreenPoint } | null = null;

  /** 画面の座標を、キャンバスの中の割合（左上が 0、右下が 1）に直す */
  function toScreenPoint(event: PointerEvent): ScreenPoint {
    const rect = canvas.getBoundingClientRect();
    return {
      u: (event.clientX - rect.left) / rect.width,
      v: (event.clientY - rect.top) / rect.height,
    };
  }

  /** いま触れている 2 本の指の、間の距離と真ん中 */
  function pinchOf(points: ScreenPoint[]): { distance: number; middle: ScreenPoint } {
    const [a, b] = points;
    return {
      distance: Math.hypot(a.u - b.u, a.v - b.v),
      middle: { u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 },
    };
  }

  function onPointerDown(event: PointerEvent): void {
    pointers.set(event.pointerId, toScreenPoint(event));
    previous = null; // 指の本数が変わったら、次の動きから測り直す
  }

  function onPointerMove(event: PointerEvent): void {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, toScreenPoint(event));

    if (!isEnabled() || pointers.size !== 2) return;

    const pinch = pinchOf([...pointers.values()]);
    if (!previous || previous.distance === 0) {
      previous = pinch;
      return;
    }

    const view = photoState.get().view;
    const scale = clampScale(view.scale * (pinch.distance / previous.distance));

    // 挟んだところが指の下から逃げないように、その点を留めたまま倍率を変える。
    // 指が平行に動いたぶんは、そのまま見る場所のずれになる
    const held = photoPointAt(view, previous.middle);
    setPhotoView(viewAnchoredAt(scale, held, pinch.middle));

    previous = pinch;
  }

  function onPointerUp(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    previous = null;
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
