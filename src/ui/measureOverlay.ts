/**
 * 大きさの基準を測っている間、写真の上に描くもの。
 *
 *   測った物 … 両端の点と、それを結ぶ線。横に実寸を添える
 *   測りかけ … 押した点（1 つ目だけならその点、2 つ目まで押せば線）
 *   目の高さ … 測定から出した地平線。薄い破線。ここより上には床が無い、という目安
 *
 * 座標は写真の中の割合で持っているので、寄っても画面が回っても同じ場所に乗る。
 */

import { photoState } from '@/core/photoState';
import { solveFloorScale } from '@/core/photoMeasure';
import { viewOrigin } from '@/core/photoView';

const MEASURE_COLOR = '#ffd400';
const DRAFT_COLOR = '#00e0ff';
const HORIZON_COLOR = 'rgba(255, 255, 255, 0.7)';
const DOT_RADIUS = 6;
const LINE_WIDTH = 3;

export function createMeasureOverlay(canvas: HTMLCanvasElement): void {
  function draw(): void {
    const { isMeasuring, measures, measureDraft, view, backgroundAspect } = photoState.get();
    canvas.classList.toggle('is-showing', isMeasuring);

    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!isMeasuring) return;

    // 写真の割合を、いま見えている矩形の中の画素に直す
    const origin = viewOrigin(view);
    const pixelRatio = canvas.width / Math.max(1, canvas.clientWidth);
    const toPixel = (x: number, y: number) => ({
      x: (x - origin.x) * view.scale * canvas.width,
      y: (y - origin.y) * view.scale * canvas.height,
    });
    context.lineCap = 'round';
    context.font = `${13 * pixelRatio}px system-ui, sans-serif`;

    // 目の高さ。測定が 1 つでもあれば引ける
    const scale = backgroundAspect ? solveFloorScale(measures, backgroundAspect) : null;
    if (scale) {
      const y = toPixel(0, scale.horizonY).y;
      context.strokeStyle = HORIZON_COLOR;
      context.lineWidth = 1.5 * pixelRatio;
      context.setLineDash([6 * pixelRatio, 6 * pixelRatio]);
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = HORIZON_COLOR;
      context.fillText('目の高さ', 8 * pixelRatio, y - 6 * pixelRatio);
    }

    for (const measure of measures) {
      const a = toPixel(measure.a.x, measure.a.y);
      const b = toPixel(measure.b.x, measure.b.y);
      strokeLine(context, a, b, MEASURE_COLOR, LINE_WIDTH * pixelRatio);
      dot(context, a, MEASURE_COLOR, DOT_RADIUS * pixelRatio);
      dot(context, b, MEASURE_COLOR, DOT_RADIUS * pixelRatio);
      context.fillStyle = MEASURE_COLOR;
      context.fillText(
        `${Math.round(measure.metres * 100)} cm`,
        (a.x + b.x) / 2 + 8 * pixelRatio,
        (a.y + b.y) / 2 - 8 * pixelRatio
      );
    }

    const draft = measureDraft.map((p) => toPixel(p.x, p.y));
    if (draft.length === 2) {
      strokeLine(context, draft[0], draft[1], DRAFT_COLOR, LINE_WIDTH * pixelRatio);
    }
    for (const point of draft) dot(context, point, DRAFT_COLOR, DOT_RADIUS * pixelRatio);
  }

  draw();
  photoState.subscribe(draw);
  // 画面の大きさが変わると層の画素数も変わり、描いた絵が消える
  window.addEventListener('resize', draw);
}

function strokeLine(
  context: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  color: string,
  width: number
): void {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.stroke();
}

function dot(
  context: CanvasRenderingContext2D,
  at: { x: number; y: number },
  color: string,
  radius: number
): void {
  context.fillStyle = color;
  context.beginPath();
  context.arc(at.x, at.y, radius, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#ffffff';
  context.lineWidth = radius / 3;
  context.stroke();
}
