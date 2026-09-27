/**
 * 大きさを合わせる姿のときだけ、1 本指で線の両端を動かす。
 *
 * 端の丸（から 32 px 以内）を押すとその端が指についてくる。2 本目の指が来たら離し、
 * 写真に寄る操作（interaction/photoZoom.ts）に譲る。位置は写真の座標で持つので、
 * 寄っていても同じように動かせる。
 */

import { photoState, updateScaleLine } from '@/core/photoState';
import { photoPointAt } from '@/core/photoView';
import { endsOnScreen } from '@/ui/scaleLineOverlay';

/** 丸をこれだけ外して押しても掴める（CSS px）。指先は丸より大きい */
const GRAB_DISTANCE = 32;

export function createScaleLineDrag(canvas: HTMLElement, isActive: () => boolean): void {
  /** 掴んでいる端。掴んでいなければ null */
  let grabbed: 'a' | 'b' | null = null;

  function locate(event: PointerEvent): { x: number; y: number; u: number; v: number } {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return { x, y, u: x / rect.width, v: y / rect.height };
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!isActive()) return;
    if (!event.isPrimary) {
      grabbed = null;
      return;
    }
    const { scaleLine, view } = photoState.get();
    if (!scaleLine) return;
    const rect = canvas.getBoundingClientRect();
    const at = locate(event);
    const [a, b] = endsOnScreen(scaleLine, view, rect.width, rect.height);
    const toA = Math.hypot(a.x - at.x, a.y - at.y);
    const toB = Math.hypot(b.x - at.x, b.y - at.y);
    const nearest = toA <= toB ? 'a' : 'b';
    if (Math.min(toA, toB) <= GRAB_DISTANCE) {
      grabbed = nearest;
      canvas.setPointerCapture(event.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!grabbed || !event.isPrimary || !isActive()) return;
    const at = locate(event);
    const point = photoPointAt(photoState.get().view, { u: at.u, v: at.v });
    // 写真の外には出さない。出すと丸が掴めなくなる
    updateScaleLine({ [grabbed]: { x: clamp01(point.x), y: clamp01(point.y) } });
  });

  for (const type of ['pointerup', 'pointercancel'] as const) {
    canvas.addEventListener(type, () => {
      grabbed = null;
    });
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
