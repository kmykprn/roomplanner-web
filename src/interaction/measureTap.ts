/**
 * 大きさの基準を測っている間、写真のタップを受け取る。
 *
 * 1 回目のタップが片方の端、2 回目がもう片方の端。なぞる操作は無い。
 * 家具のドラッグはこの間止めてある（main.ts）。
 */

import { addMeasurePoint, photoState } from '@/core/photoState';
import { photoPointAt } from '@/core/photoView';

/** これ未満の移動はタップとみなす（アプリの他の場所と同じ基準） */
const TAP_DISTANCE = 8;

export function createMeasureTap(canvas: HTMLElement, isActive: () => boolean): void {
  let start: { x: number; y: number } | null = null;

  canvas.addEventListener('pointerdown', (event) => {
    if (!isActive() || !event.isPrimary) return;
    start = { x: event.clientX, y: event.clientY };
  });

  canvas.addEventListener('pointerup', (event) => {
    if (!start || !isActive() || !event.isPrimary) {
      start = null;
      return;
    }
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    start = null;
    if (moved >= TAP_DISTANCE) return;

    // キャンバスは写真が写っている矩形とぴったり重なっているので、寄っている分だけ戻せばよい
    const rect = canvas.getBoundingClientRect();
    addMeasurePoint(
      photoPointAt(photoState.get().view, {
        u: (event.clientX - rect.left) / rect.width,
        v: (event.clientY - rect.top) / rect.height,
      })
    );
  });

  for (const type of ['pointercancel', 'pointerleave'] as const) {
    canvas.addEventListener(type, () => {
      start = null;
    });
  }
}
