/**
 * 「家具の大きさを入力」の姿。切り抜く写真を選んだ直後に挟む。
 *
 * 写真ごとに 1 枚ずつ、実際の高さ（cm）を聞く。空のまま進めてよい
 * （その場合は 1 m として置く。core/furnitureHeight.ts）。
 * 「‹ 戻る」はすべて取りやめで、切り抜きは始めない。
 */

import { REAL_HEIGHT_LIMITS } from '@/core/furnitureHeight';

export interface HeightStep {
  element: HTMLElement;
  /**
   * 写真ごとの高さ（m）を聞く。入れなかった写真は null。
   * 「‹ 戻る」で取りやめたときは全体が null
   */
  ask(files: File[]): Promise<(number | null)[] | null>;
}

const HINT = [
  '実際の高さを入力すると、部屋の写真に合った大きさで表示されます。',
  '分からない場合は、空のまま進めていただけます。',
  'その場合は高さ 1 m として置き、あとからいつでも変更できます。',
];

export function createHeightStep(): HeightStep {
  const element = document.createElement('div');
  element.className = 'lib__height';
  element.hidden = true;

  const head = document.createElement('div');
  head.className = 'edit__head';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'button is-text is-small';
  back.textContent = '‹ 戻る';
  const title = document.createElement('span');
  title.className = 'edit__title';
  title.textContent = '家具の大きさを入力';
  const headSpacer = document.createElement('span');
  headSpacer.className = 'edit__spacer';
  head.append(back, title, headSpacer);

  // 選んだ写真。何枚も選んだときは「2 / 3」のように、いま何枚目かを添える
  const photoRow = document.createElement('div');
  photoRow.className = 'edit__row';
  const icon = document.createElement('span');
  icon.className = 'thumb__img edit__icon';
  const photoField = document.createElement('div');
  photoField.className = 'field';
  const photoLabel = document.createElement('span');
  photoLabel.className = 'field__label';
  const photoName = document.createElement('span');
  photoName.className = 'height-step__name';
  photoField.append(photoLabel, photoName);
  photoRow.append(icon, photoField);

  const heightField = document.createElement('div');
  heightField.className = 'field';
  const heightLabel = document.createElement('label');
  heightLabel.className = 'field__label';
  heightLabel.textContent = '家具の実際の高さ';
  heightLabel.htmlFor = 'height-step-input';
  const inline = document.createElement('div');
  inline.className = 'field__inline';
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'decimal';
  input.id = 'height-step-input';
  input.className = 'field__input field__input--short';
  input.placeholder = '例: 90';
  input.min = String(REAL_HEIGHT_LIMITS.min * 100);
  input.max = String(REAL_HEIGHT_LIMITS.max * 100);
  const unit = document.createElement('span');
  unit.textContent = 'cm';
  inline.append(input, unit);
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.append(...HINT.flatMap((line, index) => (index === 0 ? [line] : [document.createElement('br'), line])));
  heightField.append(heightLabel, inline, hint);

  const actions = document.createElement('div');
  actions.className = 'edit__actions';
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'button is-small';
  actions.append(next);

  element.append(head, photoRow, heightField, actions);

  /** いま聞いている 1 枚に答えたら呼ぶ。null は取りやめ */
  let answer: ((height: number | null | undefined) => void) | null = null;
  back.addEventListener('click', () => answer?.(undefined));
  next.addEventListener('click', () => answer?.(parseHeight(input.value)));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') next.click();
  });

  async function ask(files: File[]): Promise<(number | null)[] | null> {
    const heights: (number | null)[] = [];
    element.hidden = false;
    try {
      for (const [index, file] of files.entries()) {
        photoLabel.textContent = files.length > 1 ? `選んだ写真（${index + 1} / ${files.length}）` : '選んだ写真';
        photoName.textContent = file.name;
        const url = URL.createObjectURL(file);
        icon.style.backgroundImage = `url("${url}")`;
        input.value = '';
        next.textContent = index === files.length - 1 ? '切り抜く' : '次へ';
        input.focus();
        const height = await new Promise<number | null | undefined>((resolve) => {
          answer = resolve;
        });
        URL.revokeObjectURL(url);
        if (height === undefined) return null;
        heights.push(height);
      }
      return heights;
    } finally {
      answer = null;
      element.hidden = true;
    }
  }

  return { element, ask };
}

/** 入力を m にする。空や数でないものは「入れなかった」扱い */
export function parseHeight(value: string): number | null {
  const centimetres = Number(value.trim());
  if (value.trim() === '' || !Number.isFinite(centimetres) || centimetres <= 0) return null;
  return centimetres / 100;
}
