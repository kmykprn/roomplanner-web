/**
 * 「床に合わせる」姿。写真モードの「背景」タブから入る。
 *
 * 写真の上に四隅のマス目が出る（ui/floorGrid.ts）。利用者は四隅を動かして、
 * マス目を写真の床に貼り付いて見えるようにする。四隅から傾きが決まる（core/floorCorners.ts）。
 *
 * 辺の 1 本の実際の長さを入れてもらえれば、写真の縮尺（カメラの高さ）も決まる。
 * 入れなければ立って撮った写真として扱う。長さを入れる辺は写真の上でタップして選ぶ。
 */

import {
  photoState,
  resetFloorCorners,
  setFittingFloor,
  updateFloorCorners,
} from '@/core/photoState';

const GUIDE = 'マス目が床に貼り付いて見えるように、四隅の ● を動かしてください。';
const HINT =
  '目安: 床板の継ぎ目・ラグの縁・壁と床の境目に、マス目の線が重なれば合っています。';
const LENGTH_HINT =
  'オレンジの辺が実際に何 cm あるかを入れると、家具の大きさが写真に合います。' +
  '辺をタップすると、長さを入れる辺を選べます。分からなければ空のままで大丈夫です' +
  '（立って撮った写真として大きさを決めます）。';

/** 長さとして受け付ける範囲（cm） */
const LENGTH_LIMITS = { min: 5, max: 2000 };

export function createFloorPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'floor-fit';

  const head = document.createElement('div');
  head.className = 'edit__head';
  const title = document.createElement('span');
  title.className = 'edit__title';
  title.textContent = '床に合わせる';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'button is-small';
  done.textContent = '完了';
  done.addEventListener('click', () => setFittingFloor(false));
  head.append(title, done);

  const guide = document.createElement('p');
  guide.className = 'floor-fit__guide';
  guide.textContent = GUIDE;
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = HINT;

  // 大きさの基準: オレンジの辺の長さ
  const lengthField = document.createElement('div');
  lengthField.className = 'field';
  const lengthLabel = document.createElement('label');
  lengthLabel.className = 'field__label';
  lengthLabel.textContent = 'オレンジの辺の長さ（分かれば）';
  lengthLabel.htmlFor = 'floor-fit-length';
  const inline = document.createElement('div');
  inline.className = 'field__inline';
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'decimal';
  input.id = 'floor-fit-length';
  input.className = 'field__input field__input--short';
  input.placeholder = '例: 120';
  input.min = String(LENGTH_LIMITS.min);
  input.max = String(LENGTH_LIMITS.max);
  const unit = document.createElement('span');
  unit.textContent = 'cm';
  inline.append(input, unit);
  const lengthHint = document.createElement('p');
  lengthHint.className = 'hint';
  lengthHint.textContent = LENGTH_HINT;
  lengthField.append(lengthLabel, inline, lengthHint);

  input.addEventListener('change', () => {
    const centimetres = Number(input.value);
    // 空にしたら長さを外す（立って撮った高さに戻る）
    const valid =
      input.value.trim() !== '' && Number.isFinite(centimetres) && centimetres >= LENGTH_LIMITS.min && centimetres <= LENGTH_LIMITS.max;
    updateFloorCorners({ length: valid ? centimetres / 100 : null });
  });

  // やり直し。触りすぎて分からなくなったときに戻れる場所を必ず残す
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'button is-quiet is-small';
  reset.textContent = '最初に戻す';
  reset.addEventListener('click', resetFloorCorners);
  const footer = document.createElement('div');
  footer.className = 'edit__actions';
  footer.append(reset);

  panel.append(head, guide, hint, lengthField, footer);

  function render(): void {
    const { isFittingFloor, scaleLength } = photoState.get();
    panel.hidden = !isFittingFloor;
    if (!isFittingFloor) return;
    // 打ち込んでいる最中は書き戻さない（入力が消える）
    if (document.activeElement !== input) input.value = scaleLength ? String(Math.round(scaleLength * 100)) : '';
  }
  render();
  photoState.subscribe(render);

  return panel;
}
