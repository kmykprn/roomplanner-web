/**
 * 写真の上に、押せる縁と選んだ縁を描く。
 *
 * 描くのは 3 種類。
 *
 *   薄いマゼンタ … 押せる候補。「ここを押せばいい」と分かるための目安
 *   黄色・水色   … 選んだ 2 本。色を分けるのは、2 本目がどれか分かるようにするため
 *   白い丸       … 選んだ線の端。どこまでたどれたかが見える
 *
 * 座標は写真の中の割合で持っているので、寄っても画面が回っても同じ場所に乗る。
 */

import { photoState } from '@/core/photoState';
import type { PhotoEdge } from '@/core/photoEdges';
import { viewOrigin } from '@/core/photoView';

/** 選んだ 2 本の色。1 本目と 2 本目で変える */
const PICKED_COLORS = ['#ffd400', '#00e0ff'];
const CANDIDATE_COLOR = 'rgba(255, 60, 190, 0.55)';

/** 線の太さ（CSS 画素）。細いと写真に埋もれ、太いと縁そのものを隠す */
const PICKED_WIDTH = 3;
const CANDIDATE_WIDTH = 2;
const END_RADIUS = 5;

export function createEdgeOverlay(canvas: HTMLCanvasElement): void {
  function draw(): void {
    const { isFittingFloor, floorFitTool, verticalEdges, edgeCandidates, view } =
      photoState.get();
    const showing = isFittingFloor && floorFitTool === 'edges';
    canvas.classList.toggle('is-showing', showing);

    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!showing) return;

    // 写真の割合を、いま見えている矩形の中の画素に直す
    const origin = viewOrigin(view);
    const pixelRatio = canvas.width / Math.max(1, canvas.clientWidth);
    const toPixel = (x: number, y: number) => ({
      x: (x - origin.x) * view.scale * canvas.width,
      y: (y - origin.y) * view.scale * canvas.height,
    });

    context.lineCap = 'round';
    // 候補は、まだ選ばれていないものだけ出す（選んだ線の下に重なると色が濁る）
    context.strokeStyle = CANDIDATE_COLOR;
    context.lineWidth = CANDIDATE_WIDTH * pixelRatio;
    for (const edge of edgeCandidates) {
      if (verticalEdges.some((picked) => isSameEdge(picked, edge))) continue;
      strokeEdge(context, edge, toPixel);
    }

    verticalEdges.forEach((edge, index) => {
      context.strokeStyle = PICKED_COLORS[index] ?? PICKED_COLORS[0];
      context.lineWidth = PICKED_WIDTH * pixelRatio;
      strokeEdge(context, edge, toPixel);

      // 端に丸を打つ。どこまでたどれたかが分かると、「もっと伸ばす」が要るか判断できる
      context.fillStyle = '#ffffff';
      for (const point of [toPixel(edge.x1, edge.y1), toPixel(edge.x2, edge.y2)]) {
        context.beginPath();
        context.arc(point.x, point.y, END_RADIUS * pixelRatio, 0, Math.PI * 2);
        context.fill();
      }
    });
  }

  draw();
  photoState.subscribe(draw);
  // 画面の大きさが変わると層の画素数も変わり、描いた絵が消える
  window.addEventListener('resize', draw);
}

function strokeEdge(
  context: CanvasRenderingContext2D,
  edge: PhotoEdge,
  toPixel: (x: number, y: number) => { x: number; y: number }
): void {
  const top = toPixel(edge.x1, edge.y1);
  const bottom = toPixel(edge.x2, edge.y2);
  context.beginPath();
  context.moveTo(top.x, top.y);
  context.lineTo(bottom.x, bottom.y);
  context.stroke();
}

/** 同じ縁か。候補と選んだ線が重なって描かれるのを避けるためだけの判定 */
function isSameEdge(a: PhotoEdge, b: PhotoEdge): boolean {
  return Math.abs(a.x1 - b.x1) < 0.005 && Math.abs(a.x2 - b.x2) < 0.005;
}
