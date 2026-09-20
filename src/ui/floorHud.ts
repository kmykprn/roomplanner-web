/**
 * 床を合わせている間、キャンバスの上に重ねる目安のバー。
 *
 * **動かしても何も変わらないと、効いているのか分からない。**
 * いまの傾きが動かせる幅のどのあたりかを、バーの伸び具合で返す。
 *
 * **度数は出さない。** 何度が正しいかは誰にも分からないので、数字を見せても判断に使えない。
 * 「動いている」「端まで来た」が分かれば十分
 */

import { photoState } from '@/core/photoState';
import { FLOOR_FIT_LIMITS } from '@/core/floorFit';

export function createFloorHud(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'floor-hud';
  element.hidden = true;

  const pitch = createBar('手前 ⇕ 奥');
  const roll = createBar('左 ⇔ 右');
  element.append(pitch.element, roll.element);

  function render(): void {
    const { isFittingFloor, floorFit } = photoState.get();
    element.hidden = !isFittingFloor;
    if (!isFittingFloor) return;
    pitch.setRatio(ratioIn(floorFit.pitchDeg, FLOOR_FIT_LIMITS.pitch));
    roll.setRatio(ratioIn(floorFit.rollDeg, FLOOR_FIT_LIMITS.roll));
  }

  render();
  photoState.subscribe(render);
  return element;
}

/** 値が範囲のどのあたりか（0〜1） */
function ratioIn(value: number, limit: { min: number; max: number }): number {
  return (value - limit.min) / (limit.max - limit.min);
}

function createBar(label: string): { element: HTMLElement; setRatio(ratio: number): void } {
  const element = document.createElement('div');
  element.className = 'floor-hud__bar';

  const track = document.createElement('span');
  track.className = 'floor-hud__track';
  const fill = document.createElement('span');
  fill.className = 'floor-hud__fill';
  track.append(fill);

  const caption = document.createElement('span');
  caption.className = 'floor-hud__label';
  caption.textContent = label;

  element.append(track, caption);
  return {
    element,
    setRatio(ratio: number) {
      fill.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
    },
  };
}
