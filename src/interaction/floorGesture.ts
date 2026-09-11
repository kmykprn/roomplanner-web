/**
 * 写真の上で、指で床を動かす。
 *
 *   1本指で上下 … 傾き（床の寝かせ具合）
 *   1本指で左右 … 向き（マス目の向き）
 *   2本指ピンチ … 高さ（マス目の大きさ）
 *   2本指ひねり … 水平（写真の傾き）
 *
 * ボタン（`ui/alignPanel.ts`）と同じ値を触る。**どちらが使いやすいかを決めるため、
 * 両方を同時に使えるようにしてある。**
 *
 * 動くのは「床」タブを開いている間だけ。開いていない間は家具のドラッグに譲る。
 */

import { adjustFloorView, photoState } from '@/core/photoState';

/** 指1ピクセルあたりの変化量（度）。画面の高さぶん動かすと一周しない程度に抑える */
const PITCH_PER_PIXEL = 0.15;
const YAW_PER_PIXEL = 0.3;

export function createFloorGesture(canvas: HTMLCanvasElement): () => void {
  /** 画面に触れている指。2本指の判定に使う */
  const pointers = new Map<number, { x: number; y: number }>();

  /** 2本指の前回の間隔と角度。1フレーム目は基準を取るだけ */
  let previousSpread = 0;
  let previousAngle = 0;

  function isActive(): boolean {
    return photoState.get().isAligning;
  }

  function onPointerDown(event: PointerEvent): void {
    if (!isActive()) return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // 指の本数が変わったら、ピンチとひねりの基準を取り直す
    previousSpread = 0;
    previousAngle = 0;
  }

  function onPointerMove(event: PointerEvent): void {
    const previous = pointers.get(event.pointerId);
    if (!previous || !isActive()) return;

    const deltaX = event.clientX - previous.x;
    const deltaY = event.clientY - previous.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      tilt(deltaX, deltaY);
    } else if (pointers.size === 2) {
      pinchAndTwist();
    }
  }

  function onPointerUp(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    previousSpread = 0;
    previousAngle = 0;
  }

  /**
   * 1本指。上へ動かすと見下ろす角度が増え、床が寝て見える。
   * 「床の奥をつまんで持ち上げる」向きに合わせてある
   */
  function tilt(deltaX: number, deltaY: number): void {
    const { floorView } = photoState.get();
    adjustFloorView({
      pitch: floorView.pitch - deltaY * PITCH_PER_PIXEL,
      yaw: floorView.yaw + deltaX * YAW_PER_PIXEL,
    });
  }

  /** 2本指。間隔で高さ、角度で水平を変える */
  function pinchAndTwist(): void {
    const [a, b] = [...pointers.values()];
    const spread = Math.hypot(a.x - b.x, a.y - b.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);

    const { floorView } = photoState.get();
    const patch: { height?: number; roll?: number } = {};

    if (previousSpread > 0 && spread > 0) {
      // 指を広げるとマス目が大きくなる＝床に近づく＝高さが下がる
      patch.height = floorView.height * (previousSpread / spread);
    }
    if (previousAngle !== 0) {
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
