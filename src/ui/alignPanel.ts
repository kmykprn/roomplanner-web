/**
 * 写真モードの「床」タブ。方眼が写真の床に乗って見えるまで合わせてもらう。
 *
 * **ボタンと指の操作の両方を用意してある。** どちらが使いやすいかを決めるため、
 * 同時に使える（指の操作は `interaction/floorGesture.ts`）。
 * ボタンは押しっぱなしで動き続ける。細かく詰めるときはこちらが向く。
 */

import { adjustFloorView, photoState, resetFloorView } from '@/core/photoState';
import { CELL_METERS, forwardOnFloor, STEPS, type FloorView } from '@/core/floorView';

const GUIDE = `方眼が床に乗って見えるまで動かしてください（細い線 ${CELL_METERS * 100}cm / 太い線 2m）`;
const NO_PHOTO = '先に「背景」タブで写真を選んでください';
const GESTURE_HINT =
  '写真の上を1本指でなぞると、方眼をつかんで動かせます（2本指＝大きさ・水平）。' +
  '大きさは、太い線1つぶんがソファの幅くらいになるのが目安';

/** 押しっぱなしで動き出すまでの待ち時間と、その後の間隔（ミリ秒） */
const REPEAT_DELAY_MS = 350;
const REPEAT_INTERVAL_MS = 70;

/** 各行の作り。ボタンの向きと、1回ぶんの動かし方をまとめて持つ */
const ROWS: Array<{
  label: string;
  /** 減らす側・増やす側のボタンに出す文字 */
  marks: [string, string];
  /** ボタンに読ませる説明。文字だけでは向きが分からないため */
  directions: [string, string];
  /** 1回ぶん動かしたあとの値。位置のように2つ同時に変わるものもある */
  step: (view: FloorView, direction: -1 | 1) => Partial<FloorView>;
  /** 画面に出す値 */
  format: (view: FloorView) => string;
}> = [
  {
    label: '位置',
    marks: ['↓', '↑'],
    directions: ['手前へ', '奥へ'],
    /**
     * 方眼を、画面の奥⇄手前へ滑らせる。
     *
     * 向きを変えると「奥」の指す方角も変わるので、そのときの向きから出す。
     * 左右へ動かすのは1本指のドラッグのほうが速いので、ボタンには置かない
     */
    step: (view, direction) => {
      const [forwardX, forwardZ] = forwardOnFloor(view);
      return {
        offsetX: view.offsetX + forwardX * STEPS.offset * direction,
        offsetZ: view.offsetZ + forwardZ * STEPS.offset * direction,
      };
    },
    format: (view) => describeOffset(view),
  },
  {
    label: '傾き',
    marks: ['▽', '△'],
    directions: ['寝かせる', '起こす'],
    step: (view, direction) => ({ pitch: view.pitch + STEPS.pitch * direction }),
    format: (view) => `${Math.round(view.pitch)}°`,
  },
  {
    label: '向き',
    marks: ['↺', '↻'],
    directions: ['左へ回す', '右へ回す'],
    step: (view, direction) => ({ yaw: view.yaw + STEPS.yaw * direction }),
    format: (view) => `${Math.round(view.yaw)}°`,
  },
  {
    label: '大きさ',
    marks: ['−', '＋'],
    directions: ['小さく', '大きく'],
    /**
     * **＋でマス目が大きくなる向きにする。**
     *
     * 中身は撮った人の目の高さで、上げるほどマス目は小さく見える。
     * 数値の増減をそのままボタンに割り当てると、＋を押してマス目が縮む。
     * 使う人が見ているのはマス目なので、見えるとおりの向きに合わせる
     */
    step: (view, direction) => ({
      height: direction > 0 ? view.height / STEPS.heightRatio : view.height * STEPS.heightRatio,
    }),
    format: (view) => `目線 ${view.height.toFixed(2)}m`,
  },
  {
    label: '水平',
    marks: ['↺', '↻'],
    directions: ['左へ傾ける', '右へ傾ける'],
    step: (view, direction) => ({ roll: view.roll + STEPS.roll * direction }),
    format: (view) => `${view.roll.toFixed(1)}°`,
  },
];

/** 方眼をどれだけ動かしたか。向きが変わっても「奥／手前」で読めるようにする */
function describeOffset(view: FloorView): string {
  const [forwardX, forwardZ] = forwardOnFloor(view);
  const forward = view.offsetX * forwardX + view.offsetZ * forwardZ;
  const sideways = view.offsetX * forwardZ - view.offsetZ * forwardX;

  if (Math.hypot(forward, sideways) < 0.05) return '中央';
  const depth = `${forward >= 0 ? '奥' : '手前'} ${Math.abs(forward).toFixed(1)}m`;
  return Math.abs(sideways) < 0.05 ? depth : `${depth} / 横 ${Math.abs(sideways).toFixed(1)}m`;
}

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
      createRepeatButton(row.marks[index], `${row.label}を${row.directions[index]}`, () =>
        adjustFloorView(row.step(photoState.get().floorView, direction))
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
