/**
 * 「寸法」の画面。写真モードの「背景」タブの「背景の調整」から入る。
 *
 * 背景の画像の上にオレンジの線が出る（ui/scaleLineOverlay.ts）。利用者はその両端を、
 * 長さの分かる物に合わせ、実際の長さを cm で入れる。線は最大 5 本まで足せ、増やすほど正確になる。
 * 「室内の寸法を計算」を押すと、写真の傾き・画角・奥行きを出し、奥行きを線の長さに合わせる。
 * そのあとは、家具が足元の奥行きに合った大きさで写る（core/depthPlacement.ts）。
 *
 * 線は床に着いていなくてよい。家具は隠さないので、計算したその場で大きさが変わり、
 * 自然に見えるかを確かめられる。「戻る」は入ったときの線に戻す。
 */

import {
  addScaleLine,
  measureRoom,
  photoState,
  removeScaleLine,
  resetScale,
  scaleOutdated,
  selectScaleLine,
  setScaleLines,
  setScaling,
  updateScaleLine,
} from '@/core/photoState';
import { MAX_SCALE_LINES, measuredLines, type ScaleLine } from '@/core/scaleLine';
import { createMeasureStatus } from '@/ui/measureStatus';
import { createQuietButton, createSentences, createSubScreen } from '@/ui/subScreen';

/** 長さとして受け付ける範囲（cm） */
const LENGTH_LIMITS = { min: 5, max: 2000 };

const PURPOSE = '寸法を合わせると、家具が背景の中の物と同じ縮尺で表示されます。';
const STEPS = [
  '寸法が分かっている物に、オレンジの線を合わせてください。',
  '線に合わせた物の長さを、cm で入力してください。',
  `線を増やすと、寸法の計算が正確になります（${MAX_SCALE_LINES} 本まで）。`,
];
const OUTDATED = '線を変えたので、もう一度「室内の寸法を計算」を押してください。';

/** 線 1 本ぶんの行。「線1」、長さの欄、削除 */
interface LineRow {
  element: HTMLElement;
  name: HTMLButtonElement;
  input: HTMLInputElement;
  remove: HTMLButtonElement;
}

function createLineRow(index: number): LineRow {
  const element = document.createElement('div');
  element.className = 'scale-line';

  // 行の名前を押すと、その線を選ぶ（画面の線が太くなる）
  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'scale-line__name';
  name.textContent = `線${index + 1}`;
  name.addEventListener('click', () => selectScaleLine(index));

  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'decimal';
  input.id = `scale-length-${index + 1}`;
  input.className = 'field__input field__input--short';
  input.placeholder = '例: 120';
  input.min = String(LENGTH_LIMITS.min);
  input.max = String(LENGTH_LIMITS.max);
  input.setAttribute('aria-label', `線${index + 1}に合わせた物の長さ（cm）`);
  input.addEventListener('focus', () => selectScaleLine(index));
  input.addEventListener('change', () => {
    const centimetres = Number(input.value);
    const valid =
      input.value.trim() !== '' && Number.isFinite(centimetres) && centimetres >= LENGTH_LIMITS.min && centimetres <= LENGTH_LIMITS.max;
    // 空にしたら長さを外す（その線は計算に使わない）
    updateScaleLine(index, { length: valid ? centimetres / 100 : null });
  });
  const unit = document.createElement('span');
  unit.textContent = 'cm';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'button is-text is-small scale-line__remove';
  remove.textContent = '削除';
  remove.setAttribute('aria-label', `線${index + 1}を削除`);
  remove.addEventListener('click', () => removeScaleLine(index));

  element.append(name, input, unit, remove);
  return { element, name, input, remove };
}

export function createScalePanel(): HTMLElement {
  /** 入ったときの線。「戻る」でここに戻す */
  let entered: ScaleLine[] | undefined;

  const screen = createSubScreen({
    title: '寸法',
    onBack: () => {
      if (entered !== undefined) setScaleLines(entered);
      setScaling(false);
    },
    onDone: () => setScaling(false),
  });

  const list = document.createElement('div');
  list.className = 'scale-lines';
  let rows: LineRow[] = [];

  const addButton = createQuietButton('線を追加', addScaleLine);
  addButton.classList.add('scale__add');

  // 室内の寸法の計算。長さを入れてから押してもらう（傾き・画角・奥行きをまとめて出す）
  const measureButton = document.createElement('button');
  measureButton.type = 'button';
  measureButton.className = 'button scale__measure';
  measureButton.textContent = '室内の寸法を計算';
  measureButton.addEventListener('click', () => void measureRoom());
  const measureStatus = createMeasureStatus();

  const outdated = document.createElement('p');
  outdated.className = 'hint';
  outdated.textContent = OUTDATED;

  screen.body.append(
    createSentences([PURPOSE], 'sub__text is-sub'),
    createSentences(STEPS),
    list,
    addButton,
    measureButton,
    measureStatus,
    outdated
  );
  // 線を 1 本に戻して元の位置に置き、長さも消す
  screen.actions.append(createQuietButton('寸法を解除', resetScale));

  function render(): void {
    const { isScaling, scaleLines, selectedScaleLine, backgroundStatus, measure } = photoState.get();
    if (isScaling && screen.element.hidden !== false) entered = scaleLines.map((line) => ({ ...line }));
    if (!isScaling) entered = undefined;
    screen.element.hidden = !isScaling;
    if (!isScaling) return;

    // 本数が変わったときだけ行を作り直す（打ち込んでいる欄を消さないように）
    if (rows.length !== scaleLines.length) {
      rows = scaleLines.map((_, index) => createLineRow(index));
      list.replaceChildren(...rows.map((row) => row.element));
    }
    scaleLines.forEach((line, index) => {
      const row = rows[index];
      const selected = index === selectedScaleLine;
      row.element.classList.toggle('is-selected', selected);
      row.name.setAttribute('aria-pressed', String(selected));
      // 最後の 1 本は消せない（線が無いと合わせられない）
      row.remove.hidden = scaleLines.length <= 1;
      if (document.activeElement !== row.input) row.input.value = line.length ? String(Math.round(line.length * 100)) : '';
    });

    addButton.disabled = scaleLines.length >= MAX_SCALE_LINES;
    measureButton.disabled =
      backgroundStatus !== 'ready' || measuredLines(scaleLines).length === 0 || measure.status === 'running';
    outdated.hidden = measure.status === 'running' || !scaleOutdated();
  }
  screen.element.hidden = true;
  render();
  photoState.subscribe(render);

  return screen.element;
}
