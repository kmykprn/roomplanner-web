/**
 * 円形プログレスインジケーター。
 *
 * ## 何を表しているか（重要）
 *
 * **サーバーは進捗率を返さない。** 状態は queued / running / succeeded の3つだけで、
 * 「いま何％」は分からない。だからこの円が表しているのは進捗ではなく、
 * **経過時間 ÷ 実測の想定時間（502秒）** という見込みでしかない。
 *
 * 見込みを超えたときに円が満杯で止まると「終わったはずなのに終わらない」
 * という最悪の見え方になるので、**95%で頭打ち**にし、超えたぶんは
 * 文言のほうで伝える（呼び出し側の describe が担当）。
 */

const SIZE = 96;
const STROKE = 8;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * 見込みを超えても満杯にしない上限。
 * 残り5%を空けておくことで「まだ動いている」ことを示す
 */
const MAX_FILL = 0.95;

export interface ProgressRing {
  element: SVGSVGElement;
  /** @param ratio 0〜1。1を超えても満杯にはしない */
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
      const filled = Math.min(Math.max(ratio, 0), MAX_FILL);
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
