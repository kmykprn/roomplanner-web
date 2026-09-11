/**
 * 押している間くり返すボタン。
 *
 * 1回ぶんが小さい操作（5cm 上げる・1割大きくする）は、押しっぱなしで
 * 動き続けないと詰められない。指を離す・画面の外へ出る・掴みを取られる、
 * のどれでも止める。
 */

/** 押しっぱなしで動き出すまでの待ち時間と、その後の間隔（ミリ秒） */
const REPEAT_DELAY_MS = 350;
const REPEAT_INTERVAL_MS = 70;

export function createRepeatButton(
  mark: string,
  /** 読み上げ用の説明。記号だけでは向きが分からないため */
  label: string,
  act: () => void
): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'nudge';
  button.textContent = mark;
  button.setAttribute('aria-label', label);

  let delayTimer = 0;
  let repeatTimer = 0;

  function stop(): void {
    clearTimeout(delayTimer);
    clearInterval(repeatTimer);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
  }

  button.addEventListener('pointerdown', (event) => {
    // 押したところで指を固定する。動かしても離すまでこのボタンが受け取る
    button.setPointerCapture(event.pointerId);
    act();
    delayTimer = window.setTimeout(() => {
      repeatTimer = window.setInterval(act, REPEAT_INTERVAL_MS);
    }, REPEAT_DELAY_MS);

    // 離す合図は window でも聞く。押している間に画面が描き直されてこのボタンが
    // DOM から外れると、ボタン自身には pointerup が届かず、動き続けてしまう
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  });

  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
    button.addEventListener(type, stop);
  }

  return button;
}
