/**
 * 床に合わせる四隅とマス目を、写真の上の線の層（viewer.overlayLayer）に描く。
 *
 * マス目は四隅を結ぶ台形を、床の上の正方形の格子として透視で描いたもの。
 * 床の線（床板の継ぎ目・ラグの縁・壁との境目）と重なれば、傾きが合っている。
 * 長さを入れる辺はオレンジにして「この辺の長さ」と添える。
 *
 * 写真の座標で持っている四隅を、寄り具合（PhotoView）を通して画面の位置に直して描く。
 */

import type { CornerEdge, FloorCorners } from '@/core/floorCorners';
import { screenPointOf, type PhotoView } from '@/core/photoView';

/** マス目の分け方（片側） */
const DIVISIONS = 6;
const GRID_COLOR = 'rgba(80, 215, 255, 0.8)';
const FILL_COLOR = 'rgba(80, 215, 255, 0.16)';
const EDGE_COLOR = 'rgb(80, 215, 255)';
const SCALE_EDGE_COLOR = 'rgb(255, 149, 0)';
/** 四隅の丸の半径（CSS px）。指で掴む場所なので大きめ */
export const HANDLE_RADIUS = 11;

type Point = { x: number; y: number };

/**
 * 単位正方形を四隅へ写す射影変換（Heckbert の式）。
 * (0,0)→手前左、(1,0)→手前右、(1,1)→奥右、(0,1)→奥左
 */
function squareToQuad([p0, p1, p2, p3]: Point[]): (u: number, v: number) => Point {
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  let a: number, b: number, d: number, e: number, g: number, h: number;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    // 平行四辺形。透視の分母は 1 のまま
    a = p1.x - p0.x; b = p2.x - p1.x; d = p1.y - p0.y; e = p2.y - p1.y; g = 0; h = 0;
  } else {
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
    const det = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / det;
    h = (dx1 * sy - sx * dy1) / det;
    a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + h * p3.x;
    d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + h * p3.y;
  }
  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + p0.x) / w, y: (d * u + e * v + p0.y) / w };
  };
}

/** 四隅を、線の層の CSS px に直す */
export function cornersOnScreen(
  corners: FloorCorners,
  view: PhotoView,
  width: number,
  height: number
): Point[] {
  return corners.map((corner) => {
    const screen = screenPointOf(view, corner);
    return { x: screen.u * width, y: screen.v * height };
  });
}

/** 描く。corners が null なら消すだけ */
export function drawFloorGrid(
  canvas: HTMLCanvasElement,
  corners: FloorCorners | null,
  view: PhotoView,
  scaleEdge: CornerEdge
): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!corners) return;

  // CSS px で描く。画素数は端末に合わせてあるので、その比で拡大する
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;
  context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);

  const points = cornersOnScreen(corners, view, width, height);
  const map = squareToQuad(points);

  context.beginPath();
  points.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
  context.closePath();
  context.fillStyle = FILL_COLOR;
  context.fill();

  // マス目。射影変換で直線は直線に写るので、両端を写して結べばよい
  context.strokeStyle = GRID_COLOR;
  context.lineWidth = 1;
  context.beginPath();
  for (let i = 1; i < DIVISIONS; i += 1) {
    const t = i / DIVISIONS;
    for (const [from, to] of [[map(t, 0), map(t, 1)], [map(0, t), map(1, t)]]) {
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
    }
  }
  context.stroke();

  // 四辺。長さを入れる辺だけオレンジで太く
  points.forEach((point, index) => {
    const next = points[(index + 1) % 4];
    const isScale = index === scaleEdge;
    context.strokeStyle = isScale ? SCALE_EDGE_COLOR : EDGE_COLOR;
    context.lineWidth = isScale ? 5 : 3;
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(next.x, next.y);
    context.stroke();
  });

  // 長さを入れる辺の札。辺の真ん中から、台形の内側へ少し寄せて置く
  const a = points[scaleEdge];
  const b = points[(scaleEdge + 1) % 4];
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const toward = Math.hypot(center.x - mid.x, center.y - mid.y) || 1;
  const labelAt = { x: mid.x + ((center.x - mid.x) / toward) * 18, y: mid.y + ((center.y - mid.y) / toward) * 18 };
  const label = 'この辺の長さ';
  context.font = '600 12px system-ui, sans-serif';
  const labelWidth = context.measureText(label).width + 16;
  context.fillStyle = SCALE_EDGE_COLOR;
  roundRect(context, labelAt.x - labelWidth / 2, labelAt.y - 11, labelWidth, 22, 6);
  context.fill();
  context.fillStyle = '#fff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, labelAt.x, labelAt.y + 1);

  // 四隅の丸
  for (const point of points) {
    context.beginPath();
    context.arc(point.x, point.y, HANDLE_RADIUS, 0, Math.PI * 2);
    context.fillStyle = 'rgba(255, 255, 255, 0.92)';
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = EDGE_COLOR;
    context.stroke();
  }
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}
