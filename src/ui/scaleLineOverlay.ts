/**
 * 「大きさを合わせる」線を、写真の上の線の層（viewer.overlayLayer）に描く。
 *
 * オレンジの線と両端の丸、真ん中に「幅 120 cm」のような札。長さを入れていなければ
 * 「長さを入力」と出す。写真の座標で持っている両端を、寄り具合（PhotoView）を通して
 * 画面の位置に直して描く。
 */

import type { FloorFit } from '@/core/floorFit';
import { resolveKind, type Lens, type ScaleLine } from '@/core/scaleLine';
import { screenPointOf, type PhotoView } from '@/core/photoView';

const LINE_COLOR = 'rgb(255, 149, 0)';
/** 両端の丸の半径（CSS px）。指で掴む場所なので大きめ */
export const HANDLE_RADIUS = 11;

/** 両端を、線の層の CSS px に直す */
export function endsOnScreen(line: ScaleLine, view: PhotoView, width: number, height: number): { x: number; y: number }[] {
  return [line.a, line.b].map((point) => {
    const screen = screenPointOf(view, point);
    return { x: screen.u * width, y: screen.v * height };
  });
}

/** 描く。line が null なら消すだけ */
export function drawScaleLine(
  canvas: HTMLCanvasElement,
  line: ScaleLine | null,
  view: PhotoView,
  fit: FloorFit,
  lens: Lens
): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!line) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;
  context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);

  const [a, b] = endsOnScreen(line, view, width, height);
  // 下に薄い影を敷いて、明るい写真の上でも線が見えるようにする
  context.lineCap = 'round';
  context.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  context.lineWidth = 8;
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.stroke();
  context.strokeStyle = LINE_COLOR;
  context.lineWidth = 4;
  context.stroke();

  for (const point of [a, b]) {
    context.beginPath();
    context.arc(point.x, point.y, HANDLE_RADIUS, 0, Math.PI * 2);
    context.fillStyle = 'rgba(255, 255, 255, 0.95)';
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = LINE_COLOR;
    context.stroke();
  }

  // 札。線の真ん中から、線に直交する向きへ少し離して置く（線に重ならないように）
  const kind = resolveKind(line, fit, lens) === 'height' ? '高さ' : '幅';
  const label = line.length ? `${kind} ${Math.round(line.length * 100)} cm` : `${kind}：長さを入力`;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const along = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let normal = { x: -(b.y - a.y) / along, y: (b.x - a.x) / along };
  if (normal.y > 0) normal = { x: -normal.x, y: -normal.y }; // 上側に出す
  const at = { x: mid.x + normal.x * 22, y: mid.y + normal.y * 22 };
  context.font = '600 12px system-ui, sans-serif';
  const labelWidth = context.measureText(label).width + 16;
  context.fillStyle = LINE_COLOR;
  context.beginPath();
  context.roundRect(at.x - labelWidth / 2, at.y - 11, labelWidth, 22, 6);
  context.fill();
  context.fillStyle = '#fff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, at.x, at.y + 1);
}
