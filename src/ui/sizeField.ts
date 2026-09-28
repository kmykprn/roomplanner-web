/**
 * 家具のサイズの欄（家具の編集の姿）。幅・奥行き・高さを cm で入れる。
 *
 *   左 … 箱の図。幅・奥行き・高さを黄色い線と名前で示し、入力中の辺の線を太く光らせる
 *   右 … 幅・奥行き・高さの欄。**どれか 1 つを変えると、残りも同じ割合で変わる**（比率を保つ）
 *
 * 家具の形（3 辺の比率）は中身から決まっているので、実際に決めるのは大きさの倍率 1 つだけ。
 * 2D（切り抜き）は板なので、奥行きの欄と線は出さない。
 * 図は決まった形の箱で、家具の実際の形ではない（どの辺のことかが分かれば足りる）。
 */

import { parseHeight } from '@/ui/heightStep';

type Size = [number, number, number];

/** 欄の並び（上から）と、サイズの何番目か。size は [幅, 高さ, 奥行き] */
const DIMENSIONS = [
  { key: 'width', label: '幅', index: 0 },
  { key: 'depth', label: '奥行き', index: 2 },
  { key: 'height', label: '高さ', index: 1 },
] as const;

type DimensionKey = (typeof DIMENSIONS)[number]['key'];

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 箱の図。立体なら斜めから見た箱、板なら正面から見た長方形。
 * 寸法の線は data-dimension で欄と結び付け、入力中の線に is-active を付ける
 */
const BOX_SVG = `
  <g class="size-figure__box">
    <path d="M36 38 L92 38 L118 54 L62 54 Z"/>
    <path d="M36 38 L36 100 L62 116 L62 54"/>
    <path d="M62 116 L118 116 L118 54"/>
    <path class="is-hidden-edge" d="M36 100 L92 100 L118 116 M92 38 L92 100"/>
  </g>
  <g class="size-figure__line" data-dimension="width"><path d="M62 125 L118 125 M62 121 L62 129 M118 121 L118 129"/><text x="90" y="138">幅</text></g>
  <g class="size-figure__line" data-dimension="height"><path d="M126 116 L126 54 M122 116 L130 116 M122 54 L130 54"/><text x="131" y="89">高さ</text></g>
  <g class="size-figure__line" data-dimension="depth"><path d="M56 122 L30 106 M54 118 L58 126 M28 102 L32 110"/><text x="8" y="126">奥行き</text></g>`;

const PANEL_SVG = `
  <g class="size-figure__box"><path d="M42 30 L108 30 L108 112 L42 112 Z"/></g>
  <g class="size-figure__line" data-dimension="width"><path d="M42 122 L108 122 M42 118 L42 126 M108 118 L108 126"/><text x="75" y="136">幅</text></g>
  <g class="size-figure__line" data-dimension="height"><path d="M117 112 L117 30 M113 112 L121 112 M113 30 L121 30"/><text x="122" y="75">高さ</text></g>`;

export interface SizeField {
  element: HTMLElement;
  /** 今のサイズ（m）を欄に出す。flat なら板（奥行きを出さない） */
  show(size: Size, flat: boolean): void;
  /** 入れたサイズ（m）。欄が空や数でなければ null */
  value(): Size | null;
}

export function createSizeField(): SizeField {
  const element = document.createElement('div');
  element.className = 'field';
  const label = document.createElement('span');
  label.className = 'field__label';
  label.textContent = 'サイズ';

  const body = document.createElement('div');
  body.className = 'size-field';
  const figure = document.createElementNS(SVG_NS, 'svg');
  figure.setAttribute('class', 'size-figure');
  figure.setAttribute('viewBox', '0 0 150 142');
  figure.setAttribute('aria-hidden', 'true');

  const inputs = document.createElement('div');
  inputs.className = 'size-field__inputs';

  /** 欄に出したときのサイズ。比率はここから取る */
  let base: Size = [1, 1, 1];
  /** いま入っているサイズ。どれかの欄を変えると、比率を保って全体が変わる */
  let current: Size = [1, 1, 1];

  const rows = DIMENSIONS.map(({ key, label: name, index }) => {
    const row = document.createElement('label');
    row.className = 'size-field__row';
    const title = document.createElement('span');
    title.className = 'size-field__name';
    title.textContent = name;
    const input = document.createElement('input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.id = `model-editor-${key}`;
    input.className = 'field__input field__input--short';
    const unit = document.createElement('span');
    unit.textContent = 'cm';
    row.append(title, input, unit);

    // 入力中の辺を図で光らせる
    input.addEventListener('focus', () => highlight(key));
    input.addEventListener('blur', () => highlight(null));
    // どれか 1 つを変えたら、同じ割合で残りも変える（打ち込んでいる欄は書き替えない）
    input.addEventListener('input', () => {
      const metres = parseHeight(input.value);
      if (metres === null || base[index] <= 0) return;
      const factor = metres / base[index];
      current = [base[0] * factor, base[1] * factor, base[2] * factor];
      for (const other of rows) {
        if (other.input !== input) other.input.value = toCentimetres(current[other.index]);
      }
    });
    return { key, index, row, input };
  });
  inputs.append(...rows.map((entry) => entry.row));
  body.append(figure, inputs);
  element.append(label, body);

  function highlight(key: DimensionKey | null): void {
    figure.querySelectorAll('.size-figure__line').forEach((line) => {
      line.classList.toggle('is-active', line.getAttribute('data-dimension') === key);
    });
  }

  return {
    element,
    show(size, flat) {
      base = [...size];
      current = [...size];
      figure.innerHTML = flat ? PANEL_SVG : BOX_SVG;
      for (const entry of rows) {
        entry.row.hidden = flat && entry.key === 'depth';
        entry.input.value = toCentimetres(size[entry.index]);
      }
    },
    value() {
      return rows.every((entry) => entry.row.hidden || parseHeight(entry.input.value) !== null) ? current : null;
    },
  };
}

function toCentimetres(metres: number): string {
  return String(Math.round(metres * 100));
}
