/**
 * 床を合わせる姿のときだけ、1 本指の操作を受け取る。
 *
 *   椅子の上をなぞる … 椅子がその場所へ動く（散らかっていない床へ逃がせる）
 *   椅子の外をなぞる … 床の傾きが変わる（上下＝手前と奥、左右＝左右の傾き）
 *   椅子の外をタップ … その場所へ椅子が動く
 *
 * **タップした場所に椅子が立つ。** 触った画素から伸ばした視線が床に
 * 当たった場所に置くので、そこでは椅子が浮かない。傾きのずれは椅子の姿と影に出る。
 * 何か所かに置いて確かめられるのが、正しさの一番強い根拠になる
 * （傾きが違うと、手前で合っていても奥で破綻する）。
 *
 * **数字は出さない。** 椅子がまっすぐ立って見えるまで動かしてもらう。
 */

import { nudgeFloorFit, setDraggingFloor, setFloorProbe } from '@/core/photoState';

/**
 * 指 1px あたり何度動かすか。
 *
 * 大きいと合わせきれず、小さいと端まで滑らせても足りない。
 * 動かせる幅（ピッチ 55°・ロール 50°）を、画面の高さ・幅のおよそ 1.5 往復で
 * 端から端まで動かせるあたりに置いている
 */
const DEGREES_PER_PIXEL = 0.08;

/** これ未満の移動はタップとみなす（アプリの他の場所と同じ基準） */
const TAP_DISTANCE = 8;

export interface FloorFitDragOptions {
  /** 合わせる姿のときだけ true。それ以外では何もしない */
  isActive(): boolean;
  /** その画面の点が椅子の上か */
  hitsMarker(point: { x: number; y: number }): boolean;
}

export function createFloorFitDrag(canvas: HTMLElement, options: FloorFitDragOptions): void {
  /** 指の直前の位置（画素）と、押した時点の位置。押していなければ null */
  let last: { x: number; y: number } | null = null;
  let start: { x: number; y: number } | null = null;
  /** 椅子を掴んでいるか。押した時点で決め、離すまで変えない */
  let movingMarker = false;

  /** 画面の座標を -1〜+1 に直す。3D 側はこの形で受け取る */
  function toNdc(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    };
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!options.isActive() || !event.isPrimary) return;
    canvas.setPointerCapture(event.pointerId);
    last = { x: event.clientX, y: event.clientY };
    start = { x: event.clientX, y: event.clientY };
    movingMarker = options.hitsMarker(toNdc(event));
    setDraggingFloor(true);
    // 椅子を掴んだなら、その時点で指の下へ寄せる（掴んだ感じを出す）
    if (movingMarker) {
      const ndc = toNdc(event);
      setFloorProbe(ndc.x, ndc.y);
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!last || !options.isActive()) return;
    if (movingMarker) {
      const ndc = toNdc(event);
      setFloorProbe(ndc.x, ndc.y);
      last = { x: event.clientX, y: event.clientY };
      return;
    }
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    last = { x: event.clientX, y: event.clientY };
    // 指を下げたら見下ろす向きに増やす。画面の中の床が「手前に倒れてくる」動きと揃える
    nudgeFloorFit({ pitchDeg: dy * DEGREES_PER_PIXEL, rollDeg: dx * DEGREES_PER_PIXEL });
  });

  canvas.addEventListener('pointerup', (event) => {
    // 椅子の外を「なぞらずに離した」＝タップ。その場所へ椅子を動かす
    if (start && !movingMarker && options.isActive()) {
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (moved < TAP_DISTANCE) {
        const ndc = toNdc(event);
        setFloorProbe(ndc.x, ndc.y);
      }
    }
    finish();
  });

  for (const type of ['pointercancel', 'pointerleave'] as const) {
    canvas.addEventListener(type, finish);
  }

  function finish(): void {
    last = null;
    start = null;
    movingMarker = false;
    setDraggingFloor(false);
  }
}
