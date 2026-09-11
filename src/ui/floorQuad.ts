/**
 * 床合わせの四角。写真の上に重ねて、4隅を指で動かせるようにする。
 *
 * 3D ではなく SVG で描く。四角は「写真の中の位置」であって床の上の物ではないので、
 * カメラが変わっても動いてはいけない。3D に置くと、カメラを割り出した結果で
 * 四角自身が動いてしまい、合わせるための基準にならなくなる。
 *
 * 角以外は指を通す（`pointer-events: none`）。合わせている最中でも家具を動かせる。
 */

import { photoState, setFloorQuad } from '@/core/photoState';
import type { FloorQuad, Point2 } from '@/core/photoCalibration';

/** 掴む丸の大きさ（画面のピクセル）。指で掴める大きさにする */
const HANDLE_RADIUS = 13;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param viewport 3D を描いている入れ物
 * @param canvas   3D のキャンバス。**写真が写っている矩形そのもの**なので、
 *                 位置の変換はこれを基準にする
 */
export function createFloorQuadOverlay(viewport: HTMLElement, canvas: HTMLCanvasElement): void {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'floor-quad');

  const outline = document.createElementNS(SVG_NS, 'polygon');
  outline.setAttribute('class', 'floor-quad__outline');
  svg.appendChild(outline);

  const handles = [0, 1, 2, 3].map((index) => {
    const handle = document.createElementNS(SVG_NS, 'circle');
    handle.setAttribute('class', 'floor-quad__handle');
    handle.setAttribute('r', String(HANDLE_RADIUS));
    handle.addEventListener('pointerdown', (event) => startDrag(event, index));
    svg.appendChild(handle);
    return handle;
  });

  viewport.appendChild(svg);

  /** 写真の中の位置（0〜1）を、画面上の位置に直す */
  function toScreen(point: Point2): Point2 {
    return {
      x: canvas.offsetLeft + point.x * canvas.clientWidth,
      y: canvas.offsetTop + point.y * canvas.clientHeight,
    };
  }

  /** 画面上の位置を、写真の中の位置（0〜1）に直す。写真の外へは出さない */
  function toPhoto(event: PointerEvent): Point2 {
    const bounds = viewport.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - bounds.left - canvas.offsetLeft) / canvas.clientWidth),
      y: clamp01((event.clientY - bounds.top - canvas.offsetTop) / canvas.clientHeight),
    };
  }

  function startDrag(event: PointerEvent, index: number): void {
    // 家具のドラッグと同じ決まりで、1本目の指だけを見る
    if (!event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();

    const handle = handles[index];
    handle.setPointerCapture(event.pointerId);

    function onMove(moveEvent: PointerEvent): void {
      if (!moveEvent.isPrimary) return;
      const quad = [...photoState.get().floorQuad] as FloorQuad;
      quad[index] = toPhoto(moveEvent);
      setFloorQuad(quad);
    }

    function onUp(): void {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    }

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  function render(): void {
    const { isAligning, floorQuad, calibrationFailed } = photoState.get();
    svg.classList.toggle('is-visible', isAligning);
    if (!isAligning) return;

    // 解けない形のあいだは、そうと分かるように色を変える
    svg.classList.toggle('is-invalid', calibrationFailed);

    const screen = floorQuad.map(toScreen);
    outline.setAttribute('points', screen.map((p) => `${p.x},${p.y}`).join(' '));
    screen.forEach((point, index) => {
      handles[index].setAttribute('cx', String(point.x));
      handles[index].setAttribute('cy', String(point.y));
    });
  }

  render();
  photoState.subscribe(render);
  // 画面の向きが変わるとキャンバスの位置も変わる。四角を追従させる
  new ResizeObserver(render).observe(canvas);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
