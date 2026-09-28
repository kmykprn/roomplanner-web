/**
 * 「寸法」の画面。写真モードの「背景」タブの「背景の調整」から入る。
 *
 * 背景の画像の上にオレンジの線が出る（ui/scaleLineOverlay.ts）。利用者はその両端を、
 * 長さの分かる物に合わせ、実際の長さを cm で入れる。線は最大 5 本まで足せ、増やすほど正確になる。
 * 写真の傾き・画角・奥行きは、背景を選んだときに裏で出してある（core/photoState.ts の startAnalysis）。
 * 「保存」を押すと、奥行きを線の長さに合わせてから閉じる（解析がまだなら終わりを待つ）。
 * そのあとは、家具が足元の奥行きに合った大きさで写る（core/depthPlacement.ts）。
 *
 * **家具に反映するのは「保存」だけ。** まだ反映していない線があるあいだは「保存」を光らせる。
 * 「戻る」は入ったときの線に戻して閉じる（計算は保存でしか走らないので、取り消すものは線だけ）。
 */

import {
  addScaleLine,
  hasUnsavedScale,
  measureRoom,
  photoState,
  removeScaleLine,
  selectScaleLine,
  setScaleLines,
  setScaling,
  updateScaleLine,
} from '@/core/photoState';
import { MAX_SCALE_LINES, type ScaleLine } from '@/core/scaleLine';
import { createMeasureStatus } from '@/ui/measureStatus';
import { createQuietButton, createSentences, createSubScreen } from '@/ui/subScreen';

/** 長さとして受け付ける範囲（cm） */
const LENGTH_LIMITS = { min: 5, max: 2000 };

/** この画面の目的。見出しのすぐ下に小さく出す */
const PURPOSE = [
  '部屋の寸法を設定すると、家具の大きさが部屋の寸法に合わせて調整されます。',
  '誤差が出る場合があります。',
];
const STEPS = [
  '画像の中で、実際の寸法がわかっているもの（例：床や壁）にオレンジの線を合わせ、長さを入力してください。',
  '長さを入力したら、「保存」を押してください。',
];
const ADD_HINT = '線を増やすと、寸法の計算が正確になります。';

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

/** 線の枠のいちばん下の「＋ 線を追加」。その下に、増やすと正確になることを添える */
function createAddRow(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'scale-add';
  const label = document.createElement('span');
  label.className = 'scale-add__label';
  label.textContent = '＋ 線を追加';
  const hint = document.createElement('span');
  hint.className = 'scale-add__hint';
  hint.textContent = ADD_HINT;
  button.append(label, hint);
  button.addEventListener('click', addScaleLine);
  return button;
}

export function createScalePanel(): HTMLElement {
  /** 入ったときの線。「戻る」でここに戻す */
  let entered: ScaleLine[] | undefined;

  /** 入ったときの線に戻して閉じる（「戻る」と「あとで設定する」） */
  const leave = (): void => {
    if (entered !== undefined) setScaleLines(entered);
    setScaling(false);
  };

  const screen = createSubScreen({
    title: '寸法',
    onBack: leave,
    // まだ反映していない線があれば計算してから閉じる。計算できなければ閉じない（理由は進み具合の行に出る）
    onDone: async () => {
      if (hasUnsavedScale() && !(await measureRoom())) return;
      setScaling(false);
    },
  });

  // 線の行と「＋ 線を追加」を 1 つの枠にまとめる
  const group = document.createElement('div');
  group.className = 'scale-group';
  const list = document.createElement('div');
  list.className = 'scale-lines';
  let rows: LineRow[] = [];
  const addRow = createAddRow();
  group.append(list, addRow);

  const measureStatus = createMeasureStatus();

  screen.body.append(createSentences(PURPOSE, 'sub__text is-sub'), createSentences(STEPS), group, measureStatus);
  // 写真を選んだ流れで開いたときだけ。長さの分かる物が写っていないこともあるので、飛ばして進めるようにする
  // （飛ばしたら、立って撮った前提の大きさで置く。あとから背景タブの「寸法」で設定できる）
  const later = createQuietButton('あとで設定する', leave);
  screen.actions.append(later);

  function render(): void {
    const { isScaling, scaleLines, selectedScaleLine, measure, scalingFromSetup } = photoState.get();
    later.hidden = !scalingFromSetup;
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

    // 上限に達したら、追加の行ごと消す（告知は出さない）
    addRow.hidden = scaleLines.length >= MAX_SCALE_LINES;

    // 計算の間は、保存も戻るも押せない（途中で閉じると、どちらの線の結果か分からなくなる）
    const running = measure.status === 'running';
    screen.back.disabled = running;
    later.disabled = running;
    screen.done.disabled = running;
    // まだ家具に反映していない線があれば、保存を光らせる
    screen.done.classList.toggle('is-pending', !running && hasUnsavedScale());
  }
  screen.element.hidden = true;
  render();
  photoState.subscribe(render);

  return screen.element;
}
