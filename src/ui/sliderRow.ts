/**
 * 「見出し」と 1 本のバーからなる行。
 *
 * 「操作」タブ（家具の向き・大きさ・高さ・傾き）と、「床に合わせる」（床の傾き）で
 * 同じものを使う。**触れるバーの見た目はアプリ内で 1 つに揃える。**
 * 同じ見た目で触れるものと触れないものがあると、押しても動かない場所ができる。
 *
 * **いまの値の数字は出さない。** 出すとバーと数字の 2 か所を見比べることになるうえ、
 * 画面の中の家具や板そのものが答えなので、そちらを見ていればよい。
 * 動かせる幅だけは両端に添える（どこまで行けるかは触る前に知りたいため）。
 */

export interface SliderRowOptions {
  /** 行の左に出す見出し */
  label: string;
  min: number;
  max: number;
  /** バーの両端に添える文字。動かせる幅が見て分かるように */
  ends: [from: string, to: string];
  /** つまみが動いたとき */
  onInput(value: number): void;
}

export interface SliderRow {
  element: HTMLElement;
  /** いまの値を書き戻す。状態が変わるたびに呼ぶ */
  setValue(value: number): void;
}

export function createSliderRow(options: SliderRowOptions): SliderRow {
  const element = document.createElement('div');
  element.className = 'slider-row';

  const heading = document.createElement('span');
  heading.className = 'slider-row__label';
  heading.textContent = options.label;

  const bar = document.createElement('div');
  bar.className = 'slider-row__bar';

  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'slider-row__range';
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = '1';
  input.setAttribute('aria-label', `${options.label}を変える`);

  /**
   * つまみを掴んでいる間か。
   *
   * **掴んでいる間は、原則として値を書き戻さない。** 状態が変わるたびに setValue が
   * 来るので、書き戻すと丸めの差でつまみが指の下から逃げる
   */
  let holding = false;
  input.addEventListener('pointerdown', () => {
    holding = true;
  });
  input.addEventListener('input', () => options.onInput(Number(input.value)));
  for (const type of ['pointerup', 'pointercancel', 'blur'] as const) {
    input.addEventListener(type, () => {
      holding = false;
    });
  }

  const [from, to] = options.ends;
  bar.append(createEndLabel(from), input, createEndLabel(to));
  element.append(heading, bar);

  return {
    element,
    setValue: (value) => {
      // 丸めでは説明できないほど離れたときは、掴んでいても書き戻す。
      // 置ける範囲で止められた場合に、つまみがそこで止まって見える
      if (!holding || Math.abs(value - Number(input.value)) > 1) {
        input.value = String(value);
      }
    },
  };
}

function createEndLabel(text: string): HTMLElement {
  const element = document.createElement('span');
  element.className = 'slider-row__end';
  element.textContent = text;
  return element;
}
