/**
 * 写真モードの「床」タブ。方眼が写真の床に乗って見えるまで合わせてもらう。
 *
 * **ボタンと指の操作の両方を用意してある。** どちらが使いやすいかを決めるため、
 * 同時に使える（指の操作は `interaction/floorGesture.ts`）。
 * ボタンは押しっぱなしで動き続ける。細かく詰めるときはこちらが向く。
 */

import { adjustFloorView, photoState, resetFloorView } from '@/core/photoState';
import { CELL_METERS, STEPS, type FloorView } from '@/core/floorView';

const GUIDE = `方眼が床に乗って見えるまで動かしてください（1マス ${CELL_METERS * 100}cm）`;
const NO_PHOTO = '先に「背景」タブで写真を選んでください';
const GESTURE_HINT = '写真の上を指でも動かせます。上下＝傾き / 左右＝向き / 2本指＝大きさ・水平';

/** 押しっぱなしで動き出すまでの待ち時間と、その後の間隔（ミリ秒） */
const REPEAT_DELAY_MS = 350;
const REPEAT_INTERVAL_MS = 70;

/** 各行の作り。ボタンの向きと、1回ぶんの動かし方をまとめて持つ */
const ROWS: Array<{
  key: keyof FloorView;
  label: string;
  /** 減らす側・増やす側のボタンに出す文字 */
  marks: [string, string];
  /** 1回ぶん動かしたあとの値 */
  step: (view: FloorView, direction: -1 | 1) => number;
  /** 画面に出す値 */
  format: (view: FloorView) => string;
}> = [
  {
    key: 'pitch',
    label: '傾き',
    marks: ['▽', '△'],
    step: (view, direction) => view.pitch + STEPS.pitch * direction,
    format: (view) => `${Math.round(view.pitch)}°`,
  },
  {
    key: 'yaw',
    label: '向き',
    marks: ['↺', '↻'],
    step: (view, direction) => view.yaw + STEPS.yaw * direction,
    format: (view) => `${Math.round(view.yaw)}°`,
  },
  {
    key: 'height',
    label: '高さ',
    marks: ['−', '＋'],
    // 高さは掛け算で動かす。低いときも高いときも同じ手応えになる
    step: (view, direction) =>
      direction > 0 ? view.height * STEPS.heightRatio : view.height / STEPS.heightRatio,
    format: (view) => `${view.height.toFixed(2)} m`,
  },
  {
    key: 'roll',
    label: '水平',
    marks: ['↺', '↻'],
    step: (view, direction) => view.roll + STEPS.roll * direction,
    format: (view) => `${view.roll.toFixed(1)}°`,
  },
];

export function createAlignPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'align';

  const status = document.createElement('p');
  status.className = 'hint';

  const rows = ROWS.map((row) => {
    const element = document.createElement('div');
    element.className = 'align__row';

    const label = document.createElement('span');
    label.className = 'align__label';
    label.textContent = row.label;

    const value = document.createElement('span');
    value.className = 'align__value';

    const buttons = ([-1, 1] as const).map((direction, index) =>
      createRepeatButton(row.marks[index], `${row.label}を${direction < 0 ? '戻す' : '進める'}`, () =>
        adjustFloorView({ [row.key]: row.step(photoState.get().floorView, direction) })
      )
    );

    element.append(label, buttons[0], buttons[1], value);
    return { element, value, buttons, format: row.format };
  });

  const gestureHint = document.createElement('p');
  gestureHint.className = 'hint align__note';
  gestureHint.textContent = GESTURE_HINT;

  const resetButton = document.createElement('button');
  resetButton.className = 'button is-quiet align__reset';
  resetButton.textContent = '最初に戻す';
  resetButton.addEventListener('click', resetFloorView);

  panel.append(status, ...rows.map((row) => row.element), gestureHint, resetButton);

  function render(): void {
    const { backgroundStatus, floorView } = photoState.get();
    const hasPhoto = backgroundStatus === 'ready';

    status.textContent = hasPhoto ? GUIDE : NO_PHOTO;
    gestureHint.hidden = !hasPhoto;
    resetButton.disabled = !hasPhoto;

    for (const row of rows) {
      row.value.textContent = row.format(floorView);
      for (const button of row.buttons) button.disabled = !hasPhoto;
    }
  }

  render();
  photoState.subscribe(render);

  return panel;
}

/**
 * 押している間くり返すボタン。
 *
 * 1回ぶんが小さいので、押しっぱなしで動き続けないと詰められない。
 * 指を離す・画面の外へ出る・掴みを取られる、のどれでも止める
 */
function createRepeatButton(mark: string, label: string, act: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'align__nudge';
  button.textContent = mark;
  button.setAttribute('aria-label', label);

  let delayTimer = 0;
  let repeatTimer = 0;

  function stop(): void {
    clearTimeout(delayTimer);
    clearInterval(repeatTimer);
  }

  button.addEventListener('pointerdown', (event) => {
    if (button.disabled) return;
    // 押したところで指を固定する。動かしても離すまでこのボタンが受け取る
    button.setPointerCapture(event.pointerId);
    act();
    delayTimer = window.setTimeout(() => {
      repeatTimer = window.setInterval(act, REPEAT_INTERVAL_MS);
    }, REPEAT_DELAY_MS);
  });

  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
    button.addEventListener(type, stop);
  }

  return button;
}
