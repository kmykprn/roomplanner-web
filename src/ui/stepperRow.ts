/**
 * 「見出し」と［−］［＋］の 2 つのボタンからなる行。操作タブの「大きさ」に使う。
 *
 * バー（ui/sliderRow.ts）と違い、**動かせる幅に上限も下限も無い。** 押すたびに一定の割合で変わり、
 * 押し続けると続けて変わる。見た目はバーの行と同じ組み方（見出しが上、操作が下）にし、
 * 右端には置いたときの姿に戻すボタンを同じ場所に置く。
 *
 * **いまの値の数字は出さない。** 画面の中の家具そのものが答えなので、そちらを見ていればよい（バーの行と同じ考え）
 */

import { createIcon } from '@/ui/icons';

export interface StepperRowOptions {
  /** 行の左に出す見出し */
  label: string;
  /** ［−］［＋］の読み上げ用の名前 */
  decreaseLabel: string;
  increaseLabel: string;
  /** 右端の「戻す」ボタン。label は戻す先（「100%」） */
  reset: { label: string };
  /** 押し始め（押し続ける 1 回分の始まり）。操作の履歴の区切りに使う */
  onBegin(): void;
  /** 1 段階変える。direction は −1（小さく）か +1（大きく） */
  onStep(direction: -1 | 1): void;
  /** 離した（押し続ける 1 回分の終わり） */
  onEnd(): void;
  /** 戻すボタンを押した */
  onReset(): void;
}

export interface StepperRow {
  element: HTMLElement;
  /** 戻す先の値にあるか。あれば戻すボタンを見えなくする（押しても何も起きないため。場所は空けたまま） */
  setAtReset(atReset: boolean): void;
}

/** 押し続けたとき、続けて変わり始めるまでの間と、そのあとの間隔（ms） */
const REPEAT_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 100;

export function createStepperRow(options: StepperRowOptions): StepperRow {
  const element = document.createElement('div');
  element.className = 'slider-row stepper-row';

  const heading = document.createElement('span');
  heading.className = 'slider-row__label';
  heading.textContent = options.label;

  const bar = document.createElement('div');
  bar.className = 'slider-row__bar';

  const decrease = createStepButton('minus', options.decreaseLabel, -1);
  const increase = createStepButton('plus', options.increaseLabel, 1);

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'slider-row__reset';
  resetButton.textContent = options.reset.label;
  resetButton.setAttribute('aria-label', `${options.label}を${options.reset.label}に戻す`);
  resetButton.addEventListener('click', options.onReset);

  bar.append(decrease, increase, resetButton);
  element.append(heading, bar);

  /**
   * 1 段階変えるボタン。押した瞬間に 1 段階、押し続けると続けて変える。
   * キーボード（Enter・空白）で押したときは click が来るので、そのときも 1 段階変える
   */
  function createStepButton(icon: 'minus' | 'plus', label: string, direction: -1 | 1): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stepper-row__button';
    button.setAttribute('aria-label', label);
    button.append(createIcon(icon));

    let delayTimer = 0;
    let repeatTimer = 0;
    /** 指で押している最中か。離したあとに来る click では、もう 1 段階変えない */
    let pressing = false;

    const stop = (): void => {
      if (!pressing) return;
      pressing = false;
      window.clearTimeout(delayTimer);
      window.clearInterval(repeatTimer);
      options.onEnd();
    };

    button.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || pressing) return;
      pressing = true;
      // 指がボタンの外へ出ても離したことが分かるように掴む。掴めなくても 1 段階は変わる
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // 何もしない
      }
      options.onBegin();
      options.onStep(direction);
      delayTimer = window.setTimeout(() => {
        repeatTimer = window.setInterval(() => options.onStep(direction), REPEAT_INTERVAL_MS);
      }, REPEAT_DELAY_MS);
    });
    for (const type of ['pointerup', 'pointercancel'] as const) button.addEventListener(type, stop);
    button.addEventListener('click', (event) => {
      // 指で押したあとの click は、pointerdown で変えた分で済んでいる（detail が 0 なのはキーボード）
      if (event.detail !== 0) return;
      options.onBegin();
      options.onStep(direction);
      options.onEnd();
    });
    return button;
  }

  return {
    element,
    setAtReset: (atReset) => resetButton.classList.toggle('is-idle', atReset),
  };
}
