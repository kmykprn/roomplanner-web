/**
 * 手前にある物の指定を指で作る。
 *
 * 「手前」タブを開いている間だけ効く。1 本指が道具になり、2 本指は寄る操作のまま。
 * どの道具かは状態（maskTool.kind）が持ち、ここは指の動きを道具へ渡すだけ。
 *
 *   なぞる・消しゴム … 押して動かした通りに塗る／消す
 *   囲む             … タップで角を打つ（閉じるのはボタンか、最初の角をもう一度タップ）
 *
 * 形を描く中身は core/maskEditor.ts。
 */

import { maskEditor } from '@/core/maskEditor';
import { photoState } from '@/core/photoState';
import { photoPointAt, type PhotoPoint } from '@/core/photoView';

/** この距離（ピクセル）以内で指を離したらタップとみなす。家具の操作と同じ */
const TAP_THRESHOLD_PX = 8;

export function createMaskPaint(canvas: HTMLCanvasElement): () => void {
  /** 触れている指。2 本になったら筆を止め、タップとも見なさない */
  const activePointers = new Set<number>();
  let strokePointer: number | null = null;
  let pressPosition = { x: 0, y: 0 };

  /** 画面の座標を、寄りを織り込んで写真の中の位置に直す */
  function toPhotoPoint(event: PointerEvent): PhotoPoint {
    const rect = canvas.getBoundingClientRect();
    return photoPointAt(photoState.get().view, {
      u: (event.clientX - rect.left) / rect.width,
      v: (event.clientY - rect.top) / rect.height,
    });
  }

  function onPointerDown(event: PointerEvent): void {
    activePointers.add(event.pointerId);
    // 2 本目が触れたら筆を置く。寄る操作の途中で線が引かれないように
    if (activePointers.size > 1) {
      if (strokePointer !== null) maskEditor.endStroke();
      strokePointer = null;
      return;
    }
    const { isMasking, maskTool, backgroundStatus } = photoState.get();
    if (!isMasking || !event.isPrimary || backgroundStatus !== 'ready') return;

    pressPosition = { x: event.clientX, y: event.clientY };
    if (maskTool.kind === 'brush' || maskTool.kind === 'eraser') {
      strokePointer = event.pointerId;
      maskEditor.beginStroke(toPhotoPoint(event));
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== strokePointer) return;
    maskEditor.extendStroke(toPhotoPoint(event));
  }

  function onPointerUp(event: PointerEvent): void {
    const wasOnlyFinger = activePointers.size === 1;
    activePointers.delete(event.pointerId);

    if (event.pointerId === strokePointer) {
      strokePointer = null;
      maskEditor.endStroke();
      return;
    }

    // 囲むはタップで角を打つ。動かしていたら（寄る操作の名残など）何もしない
    const { isMasking, maskTool, backgroundStatus } = photoState.get();
    if (!isMasking || !event.isPrimary || !wasOnlyFinger || backgroundStatus !== 'ready') return;
    const moved = Math.hypot(event.clientX - pressPosition.x, event.clientY - pressPosition.y);
    if (moved >= TAP_THRESHOLD_PX) return;

    if (maskTool.kind === 'polygon') maskEditor.addCorner(toPhotoPoint(event));
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
