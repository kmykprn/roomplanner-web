/**
 * 円形プログレスインジケーター。
 *
 * ここは**描くだけ**で、何％かは決めない。割合の決め方は core/progress.ts にある
 * （サーバーが返す工程をもとにしている）。
 *
 * 分けているのは、「どこまで進んだか」の根拠がサーバー側の都合で変わるのに対し、
 * 円の描き方は変わらないため。
 */

const SIZE = 96;
const STROKE = 8;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface ProgressRing {
  element: SVGSVGElement;
  /** @param ratio 0〜1。範囲外は丸める */
  update(ratio: number, centerText: string): void;
  /** 待っている間だけ出す。SVG 要素は hidden を型が持たないのでここで包む */
  setVisible(visible: boolean): void;
}

export function createProgressRing(): ProgressRing {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute('width', String(SIZE));
  svg.setAttribute('height', String(SIZE));
  svg.setAttribute('class', 'ring');
  // 進捗そのものは中央のテキストで読めるので、図形は読み上げ対象から外す
  svg.setAttribute('aria-hidden', 'true');

  const track = circle('ring__track');
  const value = circle('ring__value');
  value.style.strokeDasharray = String(CIRCUMFERENCE);
  value.style.strokeDashoffset = String(CIRCUMFERENCE);

  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('class', 'ring__label');
  label.setAttribute('x', String(SIZE / 2));
  label.setAttribute('y', String(SIZE / 2));
  // dominant-baseline は Safari で効きが不安定なので、縦位置は dy で寄せる
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('dy', '0.36em');

  svg.append(track, value, label);

  return {
    element: svg,
    update(ratio, centerText) {
      const filled = Math.min(Math.max(ratio, 0), 1);
      value.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - filled));
      label.textContent = centerText;
    },
    setVisible(visible) {
      svg.style.display = visible ? '' : 'none';
    },
  };
}

function circle(className: string): SVGCircleElement {
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('class', className);
  c.setAttribute('cx', String(SIZE / 2));
  c.setAttribute('cy', String(SIZE / 2));
  c.setAttribute('r', String(RADIUS));
  c.setAttribute('fill', 'none');
  c.setAttribute('stroke-width', String(STROKE));
  return c;
}
