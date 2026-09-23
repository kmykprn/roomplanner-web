/**
 * 表示する範囲を調整している間だけ、1 本指で写真をずらす。
 *
 * 拡大・縮小は 2 本指（interaction/photoZoom.ts）と、「表示する範囲」のバー（ui/framePanel.ts）。
 * 2 本目の指が来たら、ずらすのをやめて拡大・縮小に譲る。
 */

import { photoState, setPhotoView } from '@/core/photoState';
import { visibleSize } from '@/core/photoView';

export function createPhotoPan(canvas: HTMLElement, isActive: () => boolean): void {
  /** 直前の指の位置（画面の割合）。押していなければ null */
  let last: { u: number; v: number } | null = null;

  function locate(event: PointerEvent): { u: number; v: number } {
    const rect = canvas.getBoundingClientRect();
    return { u: (event.clientX - rect.left) / rect.width, v: (event.clientY - rect.top) / rect.height };
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!isActive()) return;
    if (!event.isPrimary) {
      last = null; // 2 本指になったら拡大・縮小に任せる
      return;
    }
    last = locate(event);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!last || !event.isPrimary || !isActive()) return;
    const at = locate(event);
    const view = photoState.get().view;
    const { width, height } = visibleSize(view);
    // 指を右へ動かしたら写真も右へ＝見ている場所は左へ。写真の中に収めるのは setPhotoView
    setPhotoView({
      ...view,
      centerX: view.centerX - (at.u - last.u) * width,
      centerY: view.centerY - (at.v - last.v) * height,
    });
    last = at;
  });

  for (const type of ['pointerup', 'pointercancel'] as const) {
    canvas.addEventListener(type, () => {
      last = null;
    });
  }
}
