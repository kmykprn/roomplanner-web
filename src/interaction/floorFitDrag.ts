/**
 * 床を合わせる姿のときだけ、1 本指のなぞりを「床の傾き」に変える。
 *
 *   上下になぞる … 手前と奥の傾き（ピッチ）。指を下げると、より見下ろした形になる
 *   左右になぞる … 左右の傾き（ロール）
 *
 * **数字は出さない。** コーンがまっすぐ立って見えるまで動かしてもらう。
 * 家具のドラッグや写真のズームとは、合わせている間だけ役を交代する（main.ts の配線）。
 */

import { nudgeFloorFit } from '@/core/photoState';

/**
 * 指 1px あたり何度動かすか。
 *
 * 大きいと合わせきれず、小さいと端まで滑らせても足りない。
 * 動かせる幅（ピッチ 55°・ロール 50°）を、画面の高さ・幅のおよそ 1.5 往復で
 * 端から端まで動かせるあたりに置いている
 */
const DEGREES_PER_PIXEL = 0.08;

export function createFloorFitDrag(canvas: HTMLElement, isActive: () => boolean): void {
  let last: { x: number; y: number } | null = null;

  canvas.addEventListener('pointerdown', (event) => {
    if (!isActive() || !event.isPrimary) return;
    canvas.setPointerCapture(event.pointerId);
    last = { x: event.clientX, y: event.clientY };
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!last || !isActive()) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    last = { x: event.clientX, y: event.clientY };
    // 指を下げたら見下ろす向きに増やす。画面の中の床が「手前に倒れてくる」動きと揃える
    nudgeFloorFit({
      pitchDeg: dy * DEGREES_PER_PIXEL,
      rollDeg: dx * DEGREES_PER_PIXEL,
    });
  });

  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
    canvas.addEventListener(type, () => {
      last = null;
    });
  }
}
