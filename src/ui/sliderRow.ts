/**
 * 「見出し」と 1 本のバーからなる行。
 *
 * 「操作」タブ（家具の向き・大きさ・傾き）の行。
 * **触れるバーの見た目はアプリ内で 1 つに揃える。**
 * 同じ見た目で触れるものと触れないものがあると、押しても動かない場所ができる。
 *
 * **いまの値の数字は原則出さない。** 出すとバーと数字の 2 か所を見比べることになるうえ、
 * 画面の中の家具や板そのものが答えなので、そちらを見ていればよい。
 * ただし「大きさ」は、実寸どおり（100%）かどうかが見た目では分からないので、割合を右に出す（after）。
 * 動かせる幅は両端に添える（ends）。真ん中など目印にしたい値には、バーの下に目盛りを付ける（marks）。
 *
 * **中心で引っかかる（snapTo）。** 向きを 0° に、大きさを 100% に戻したいとき、指でちょうどの所に
 * 止めるのは難しい。つまみを指で動かしていて中心の近く（SNAP_PX 以内）に来たら、中心の値に吸い付かせる。
 * キーボードの矢印では吸い付かせない（1 ずつ動かしたいのに中心から出られなくなるため）。
 */

/** バーの下の目盛り 1 本 */
export interface SliderMark {
  value: number;
  /** 目盛りの下に出す数字。無ければ線だけ */
  label?: string;
  /** 中心などの目立たせる目盛り（青く長い線と太字） */
  main?: boolean;
}

/** つまみの幅（px）。つまみの中心が動ける範囲は、バーの幅からこれを引いた分（style.css と同じ値） */
const THUMB_PX = 22;
/** 中心からこの距離（px）以内に来たら吸い付く */
const SNAP_PX = 8;

export interface SliderRowOptions {
  /** 行の左に出す見出し */
  label: string;
  min: number;
  max: number;
  /** バーの両端に添える文字。動かせる幅が見て分かるように */
  ends?: [from: string, to: string];
  /** バーの下に付ける目盛り */
  marks?: SliderMark[];
  /** 指で動かしていて、この値の近くに来たら吸い付く */
  snapTo?: number;
  /** つまみが動いたとき */
  onInput(value: number): void;
  /** つまみを離したとき（動かし終わりに 1 度だけしたいことがあれば） */
  onChange?(value: number): void;
  /** バーの右端のさらに右に置くもの（数値の欄など） */
  after?: HTMLElement;
  /** 見出しを画面に出さない（説明の文が何のバーかを言っているとき）。読み上げには使う */
  hideLabel?: boolean;
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
  /** 吸い付いている間か。吸い付いた瞬間にだけ振動させる */
  let snapped = false;
  input.addEventListener('input', () => {
    let value = Number(input.value);
    const { snapTo } = options;
    if (snapTo !== undefined && holding) {
      // 値の差を、つまみが動く長さの上の距離（px）に直して比べる
      const travel = input.getBoundingClientRect().width - THUMB_PX;
      const distance = (Math.abs(value - snapTo) / (options.max - options.min)) * travel;
      const near = distance <= SNAP_PX;
      if (near) {
        value = snapTo;
        input.value = String(snapTo);
        // 対応している端末（Android など）では軽く振動させる。iPhone のブラウザは振動に対応していない
        if (!snapped) navigator.vibrate?.(8);
      }
      snapped = near;
    }
    options.onInput(value);
  });
  for (const type of ['pointerup', 'pointercancel', 'blur'] as const) {
    input.addEventListener(type, () => {
      holding = false;
    });
  }

  if (options.onChange) {
    const onChange = options.onChange;
    input.addEventListener('change', () => onChange(Number(input.value)));
  }

  // 目盛りがあれば、バーと目盛りを 1 つの枠に入れて、目盛りをバーの真下に並べる
  let range: HTMLElement = input;
  if (options.marks) {
    const track = document.createElement('div');
    track.className = 'slider-row__track';
    track.append(input, createMarks(options.marks, options.min, options.max));
    range = track;
  }
  if (options.ends) {
    const [from, to] = options.ends;
    bar.append(createEndLabel(from), range, createEndLabel(to));
  } else {
    bar.append(range);
  }
  if (options.after) bar.append(options.after);
  if (options.hideLabel) element.classList.add('slider-row--bare');
  element.append(...(options.hideLabel ? [bar] : [heading, bar]));

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

/**
 * バーの下の目盛り。つまみの中心が通る位置に合わせて置く
 * （バーの両端からつまみの半分ずつ内側。CSS の calc で、幅が変わっても合う）
 */
function createMarks(marks: SliderMark[], min: number, max: number): HTMLElement {
  const element = document.createElement('div');
  element.className = 'slider-row__marks';
  element.setAttribute('aria-hidden', 'true');
  for (const mark of marks) {
    const ratio = (mark.value - min) / (max - min);
    const left = `calc(${THUMB_PX / 2}px + ${ratio} * (100% - ${THUMB_PX}px))`;
    const tick = document.createElement('span');
    tick.className = mark.main ? 'slider-row__tick is-main' : 'slider-row__tick';
    tick.style.left = left;
    element.append(tick);
    if (mark.label) {
      const label = document.createElement('span');
      label.className = mark.main ? 'slider-row__mark-label is-main' : 'slider-row__mark-label';
      label.style.left = left;
      label.textContent = mark.label;
      element.append(label);
    }
  }
  return element;
}

function createEndLabel(text: string): HTMLElement {
  const element = document.createElement('span');
  element.className = 'slider-row__end';
  element.textContent = text;
  return element;
}
