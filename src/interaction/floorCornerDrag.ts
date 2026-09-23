/**
 * 床を合わせる姿のときだけ、1 本指の操作を受け取る。
 *
 *   四隅の丸をなぞる … その角が指についてくる。動かすたびに傾き（と高さ）を解き直す
 *   辺をタップ       … その辺が「長さを入れる辺」になる（オレンジ）
 *
 * 2 本目の指が来たら角を離す。2 本指は写真に寄る操作（interaction/photoZoom.ts）に渡す。
 * 位置は写真の座標で持つので、寄っていても同じように動かせる。
 */

import { photoState, updateFloorCorners } from '@/core/photoState';
import { photoPointAt } from '@/core/photoView';
import type { CornerEdge, FloorCorners } from '@/core/floorCorners';
import { cornersOnScreen } from '@/ui/floorGrid';

/** 丸をこれだけ外して押しても掴める（CSS px）。指先は丸より大きい */
const GRAB_DISTANCE = 32;
/** 辺からこれだけ離れていても、その辺のタップとみなす（CSS px） */
const EDGE_TAP_DISTANCE = 24;
/** これ未満の移動はタップとみなす（アプリの他の場所と同じ基準） */
const TAP_DISTANCE = 8;

export function createFloorCornerDrag(canvas: HTMLElement, isActive: () => boolean): void {
  /** 掴んでいる角。掴んでいなければ null */
  let grabbed: number | null = null;
  /** 押した位置（CSS px）。タップかどうかの判定に使う */
  let start: { x: number; y: number } | null = null;

  /** 画面の中の位置（CSS px）と、画面の中の割合 */
  function locate(event: PointerEvent): { x: number; y: number; u: number; v: number } {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return { x, y, u: x / rect.width, v: y / rect.height };
  }

  function screenCorners(): { x: number; y: number }[] | null {
    const { floorCorners, view } = photoState.get();
    if (!floorCorners) return null;
    const rect = canvas.getBoundingClientRect();
    return cornersOnScreen(floorCorners, view, rect.width, rect.height);
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!isActive()) return;
    // 2 本目の指が来たら、角を離して寄る操作に譲る
    if (!event.isPrimary) {
      grabbed = null;
      start = null;
      return;
    }
    const at = locate(event);
    start = { x: at.x, y: at.y };
    const points = screenCorners();
    if (!points) return;
    let nearest = -1;
    let nearestDistance = GRAB_DISTANCE;
    points.forEach((point, index) => {
      const distance = Math.hypot(point.x - at.x, point.y - at.y);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    });
    if (nearest >= 0) {
      grabbed = nearest;
      canvas.setPointerCapture(event.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (grabbed === null || !event.isPrimary || !isActive()) return;
    const { floorCorners, view } = photoState.get();
    if (!floorCorners) return;
    const at = locate(event);
    const point = photoPointAt(view, { u: at.u, v: at.v });
    const corners = floorCorners.map((corner, index) =>
      // 写真の外には出さない。出すと丸が掴めなくなる
      index === grabbed ? { x: clamp01(point.x), y: clamp01(point.y) } : corner
    ) as FloorCorners;
    updateFloorCorners({ corners });
  });

  canvas.addEventListener('pointerup', (event) => {
    if (!event.isPrimary) return;
    if (grabbed === null && start && isActive()) {
      const at = locate(event);
      if (Math.hypot(at.x - start.x, at.y - start.y) < TAP_DISTANCE) selectEdgeAt(at);
    }
    finish();
  });
  canvas.addEventListener('pointercancel', finish);

  /** タップした場所にいちばん近い辺を、長さを入れる辺にする */
  function selectEdgeAt(at: { x: number; y: number }): void {
    const points = screenCorners();
    if (!points) return;
    let best: CornerEdge | null = null;
    let bestDistance = EDGE_TAP_DISTANCE;
    points.forEach((point, index) => {
      const distance = distanceToSegment(at, point, points[(index + 1) % 4]);
      if (distance < bestDistance) {
        best = index as CornerEdge;
        bestDistance = distance;
      }
    });
    if (best !== null) updateFloorCorners({ edge: best });
  }

  function finish(): void {
    grabbed = null;
    start = null;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 点から線分までの距離 */
function distanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
