/**
 * 写真モードの「床」タブ。
 *
 * **ギズモとボタンの両方を用意してある。** ギズモ（写真の上の矢印とリング）で
 * 大まかに動かし、ボタンで細かく詰める。どちらも同じ値を触る。
 *
 * 出すボタンは、ギズモで触っているものに合わせて切り替える。移動を触っている
 * ときに回転のボタンまで並べると、何を動かしているのか分からなくなる。
 */

import {
  adjustFloorTransform,
  photoState,
  resetFloorTransform,
  setGizmoMode,
} from '@/core/photoState';
import { CELL_METERS, STEPS, type FloorTransform, type GizmoMode } from '@/core/floorTransform';

const GUIDE = `方眼が床に乗って見えるまで動かしてください（細い線 ${CELL_METERS * 100}cm / 太い線 2m）`;
const NO_PHOTO = '先に「背景」タブで写真を選んでください';
const GIZMO_HINT = '写真の上の矢印やリングをつかんでも動かせます';

/** 押しっぱなしで動き出すまでの待ち時間と、その後の間隔（ミリ秒） */
const REPEAT_DELAY_MS = 350;
const REPEAT_INTERVAL_MS = 70;

const MODES: Array<{ id: GizmoMode; label: string }> = [
  { id: 'translate', label: '移動' },
  { id: 'rotate', label: '回転' },
  { id: 'scale', label: '大きさ' },
];

/** ボタン1行ぶんの作り */
interface Row {
  label: string;
  /** 減らす側・増やす側のボタンに出す文字 */
  marks: [string, string];
  /** ボタンに読ませる説明。文字だけでは向きが分からないため */
  directions: [string, string];
  /** 1回ぶん動かしたあとの値 */
  step: (transform: FloorTransform, direction: -1 | 1) => Partial<FloorTransform>;
  format: (transform: FloorTransform) => string;
}

/** 移動と回転の行は「どの軸か」だけが違うので、軸ごとの見出しから組み立てる */
interface AxisRow {
  /** position / rotation の何番目を触るか（0 = X, 1 = Y, 2 = Z） */
  axis: 0 | 1 | 2;
  label: string;
  marks: [string, string];
  directions: [string, string];
}

/** 軸ごとの移動。ギズモの矢印と同じ並び（左右・上下・奥行き） */
const MOVE_AXES: AxisRow[] = [
  { axis: 0, label: '左右', marks: ['←', '→'], directions: ['左へ', '右へ'] },
  { axis: 1, label: '上下', marks: ['↓', '↑'], directions: ['下へ', '上へ'] },
  // 奥はカメラから遠ざかる向き（-Z）。画面では上へ遠のくので、印も上向きにする
  {
    axis: 2,
    label: '奥行き',
    marks: ['↑', '↓'],
    directions: ['奥へ', '手前へ'],
  },
];

/** 軸ごとの回転 */
const TURN_AXES: AxisRow[] = [
  {
    axis: 0,
    label: '傾き',
    marks: ['↺', '↻'],
    directions: ['寝かせる', '起こす'],
  },
  {
    axis: 1,
    label: '向き',
    marks: ['↺', '↻'],
    directions: ['左へ回す', '右へ回す'],
  },
  {
    axis: 2,
    label: '水平',
    marks: ['↺', '↻'],
    directions: ['左へ傾ける', '右へ傾ける'],
  },
];

const MOVE_ROWS: Row[] = MOVE_AXES.map(({ axis, label, marks, directions }) => ({
  label,
  marks,
  directions,
  step: (transform, direction) => {
    const position = [...transform.position] as [number, number, number];
    position[axis] += STEPS.position * direction;
    return { position };
  },
  format: (transform) => `${transform.position[axis].toFixed(1)} m`,
}));

const TURN_ROWS: Row[] = TURN_AXES.map(({ axis, label, marks, directions }) => ({
  label,
  marks,
  directions,
  step: (transform, direction) => {
    const rotation = [...transform.rotation] as [number, number, number];
    rotation[axis] += STEPS.rotation * direction;
    return { rotation };
  },
  format: (transform) => `${Math.round(transform.rotation[axis])}°`,
}));

const SCALE_ROWS: Row[] = [
  {
    label: '大きさ',
    marks: ['−', '＋'],
    directions: ['小さく', '大きく'],
    step: (transform, direction) => ({
      scale:
        direction > 0 ? transform.scale * STEPS.scaleRatio : transform.scale / STEPS.scaleRatio,
    }),
    format: (transform) => `×${transform.scale.toFixed(2)}`,
  },
];

const ROWS_BY_MODE: Record<GizmoMode, Row[]> = {
  translate: MOVE_ROWS,
  rotate: TURN_ROWS,
  scale: SCALE_ROWS,
};

export function createAlignPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'align';

  const status = document.createElement('p');
  status.className = 'hint';

  const modeBar = document.createElement('div');
  modeBar.className = 'align__modes';
  const modeButtons = MODES.map((mode) => {
    const button = document.createElement('button');
    button.className = 'align__mode';
    button.textContent = mode.label;
    button.addEventListener('click', () => setGizmoMode(mode.id));
    modeBar.appendChild(button);
    return button;
  });

  const rowsArea = document.createElement('div');
  rowsArea.className = 'align__rows';

  const gizmoHint = document.createElement('p');
  gizmoHint.className = 'hint align__note';
  gizmoHint.textContent = GIZMO_HINT;

  const resetButton = document.createElement('button');
  resetButton.className = 'button is-quiet align__reset';
  resetButton.textContent = '最初に戻す';
  resetButton.addEventListener('click', resetFloorTransform);

  panel.append(status, modeBar, rowsArea, gizmoHint, resetButton);

  /**
   * いま出ている行。値と押せるかどうかを書き替えられるよう控えておく。
   *
   * **ボタンは作った時点で固定しない。** 写真より先に行を作ることがあるので、
   * 作ったときの状態で無効にしたままだと、写真を選んでも押せないままになる
   */
  let visibleRows: Array<{
    row: Row;
    value: HTMLElement;
    buttons: HTMLButtonElement[];
  }> = [];
  let builtMode: GizmoMode | null = null;

  function buildRows(mode: GizmoMode): void {
    visibleRows = ROWS_BY_MODE[mode].map((row) => {
      const element = document.createElement('div');
      element.className = 'align__row';

      const label = document.createElement('span');
      label.className = 'align__label';
      label.textContent = row.label;

      const value = document.createElement('span');
      value.className = 'align__value';

      const buttons = ([-1, 1] as const).map((direction, index) =>
        createRepeatButton(row.marks[index], `${row.label}を${row.directions[index]}`, () =>
          adjustFloorTransform(row.step(photoState.get().floorTransform, direction))
        )
      );

      element.append(label, buttons[0], buttons[1], value);
      rowsArea.appendChild(element);
      return { row, value, buttons };
    });
  }

  function render(): void {
    const { backgroundStatus, floorTransform, gizmoMode } = photoState.get();
    const hasPhoto = backgroundStatus === 'ready';

    status.textContent = hasPhoto ? GUIDE : NO_PHOTO;
    gizmoHint.hidden = !hasPhoto;
    resetButton.disabled = !hasPhoto;
    modeButtons.forEach((button, index) => {
      button.classList.toggle('is-active', MODES[index].id === gizmoMode);
      button.disabled = !hasPhoto;
    });

    // 触るものが変わったときだけ作り直す。毎回作り直すと、押しっぱなしの
    // ボタンが指の下で作り替えられて途切れる
    if (builtMode !== gizmoMode) {
      rowsArea.replaceChildren();
      buildRows(gizmoMode);
      builtMode = gizmoMode;
    }

    for (const { row, value, buttons } of visibleRows) {
      value.textContent = row.format(floorTransform);
      for (const button of buttons) button.disabled = !hasPhoto;
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
