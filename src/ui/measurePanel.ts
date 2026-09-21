/**
 * 「大きさの基準」を測る姿。写真モードの「背景」タブから入る。
 *
 * 床に置いてある物の両端を 2 回タップして、その幅を入力してもらう。
 * 1 つ測れば、その写真の中で家具がどの大きさに写るべきかが決まる（core/photoMeasure.ts）。
 * 手前と奥で 2 つ測ると、カメラの高さの仮定が消えて正確になる。
 *
 * **測る物は床の上にあること。** 机の上の物を測ると、その物の高さぶんずれる。
 */

import {
  addMeasure,
  clearMeasureDraft,
  clearMeasures,
  photoState,
  removeMeasure,
  setMeasuring,
} from '@/core/photoState';
import { solveFloorScale } from '@/core/photoMeasure';

const STEP_FIRST = '床に置いてある物の片方の端をタップしてください（ゴミ箱、箱、かごなど）';
const STEP_SECOND = 'もう片方の端をタップしてください';
const STEP_LENGTH = 'その幅を入力してください';
const NOTE_ONE = '手前か奥の離れた場所でもう 1 つ測ると、より正確になります（いまはカメラの高さを 1.4m と仮定）';
const NOTE_TWO = '2 か所で測ったので、仮定なしで大きさが決まります';
const NOTE_INCONSISTENT = '2 か所の測定がかみ合いません。片方を測り直してください（いまは 1 か所だけ使っています）';

export function createMeasurePanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'measure';

  const head = document.createElement('div');
  head.className = 'edit__head';
  const title = document.createElement('span');
  title.className = 'edit__title';
  title.textContent = '大きさの基準';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'button is-small';
  done.textContent = '完了';
  done.addEventListener('click', () => setMeasuring(false));
  head.append(title, done);

  const step = document.createElement('p');
  step.className = 'hint';

  // 2 点押したあとに出す入力。cm で受けて m に直す
  const entry = document.createElement('div');
  entry.className = 'measure__entry';
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'decimal';
  input.min = '1';
  input.step = '1';
  input.placeholder = '幅';
  input.className = 'measure__input';
  input.setAttribute('aria-label', '幅（cm）');
  const unit = document.createElement('span');
  unit.className = 'measure__unit';
  unit.textContent = 'cm';
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'button is-small';
  confirm.textContent = '決定';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'button is-quiet is-small';
  retry.textContent = 'やり直す';
  retry.addEventListener('click', clearMeasureDraft);
  entry.append(input, unit, confirm, retry);

  function submit(): void {
    const centimetres = Number(input.value);
    if (!(centimetres > 0)) return;
    addMeasure(centimetres / 100);
    input.value = '';
  }
  confirm.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  // 測った物の一覧。それぞれ外せる
  const list = document.createElement('ul');
  list.className = 'measure__list';

  const note = document.createElement('p');
  note.className = 'hint';

  const clearAll = document.createElement('button');
  clearAll.type = 'button';
  clearAll.className = 'button is-quiet is-small';
  clearAll.textContent = 'すべて外す';
  clearAll.addEventListener('click', clearMeasures);
  const footer = document.createElement('div');
  footer.className = 'edit__actions';
  footer.append(clearAll);

  panel.append(head, step, entry, list, note, footer);

  function render(): void {
    const { isMeasuring, measures, measureDraft, backgroundAspect } = photoState.get();
    panel.hidden = !isMeasuring;
    if (!isMeasuring) return;

    const awaitingLength = measureDraft.length === 2;
    step.textContent = awaitingLength
      ? STEP_LENGTH
      : measureDraft.length === 1
        ? STEP_SECOND
        : STEP_FIRST;
    entry.hidden = !awaitingLength;
    if (awaitingLength && document.activeElement !== input) input.focus();

    list.replaceChildren(
      ...measures.map((measure, index) => {
        const item = document.createElement('li');
        item.className = 'measure__item';
        const label = document.createElement('span');
        label.textContent = `${index + 1} つ目 … ${Math.round(measure.metres * 100)} cm`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'button is-text is-small';
        remove.textContent = '外す';
        remove.addEventListener('click', () => removeMeasure(index));
        item.append(label, remove);
        return item;
      })
    );
    list.hidden = measures.length === 0;
    clearAll.hidden = measures.length === 0;

    const scale = backgroundAspect ? solveFloorScale(measures, backgroundAspect) : null;
    note.textContent = !scale
      ? ''
      : scale.inconsistent
        ? NOTE_INCONSISTENT
        : scale.assumed
          ? NOTE_ONE
          : NOTE_TWO;
    note.classList.toggle('is-error', Boolean(scale?.inconsistent));
    note.hidden = note.textContent === '';
  }
  render();
  photoState.subscribe(render);

  return panel;
}
