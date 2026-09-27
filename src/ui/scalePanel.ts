/**
 * 「大きさを合わせる」姿。写真モードの「背景」タブから入る。
 *
 * 写真の上にオレンジの線が 1 本出る（ui/scaleLineOverlay.ts）。利用者はその両端を、長さの
 * 分かる物に合わせ、実際の長さを cm で入れる。そこから写真の縮尺（カメラの高さ）が決まり、
 * 置いた家具が実寸どおりの大きさで写る（core/scaleLine.ts）。
 *
 * 線は「幅」（床の上の長さ）か「高さ」（床から立つ物の高さ）として読む。どちらかは線の向きで
 * 自動で決め、画面に出す。違っていれば切り替えてもらう。家具は隠さないので、長さを入れた
 * その場で大きさが変わり、自然に見えるかを確かめられる。
 */

import {
  currentScaleKind,
  photoState,
  resetScale,
  scaleUnmeasurable,
  setScaling,
  updateScaleLine,
} from '@/core/photoState';

/** 長さとして受け付ける範囲（cm） */
const LENGTH_LIMITS = { min: 5, max: 2000 };

/** 測る物の例。押すとその長さが入る（だいたいの値） */
const EXAMPLES: Record<'width' | 'height', { label: string; cm: number | null }[]> = {
  width: [
    { label: 'ラグ・マットの縁', cm: null },
    { label: 'ドアの幅（約 80 cm）', cm: 80 },
    { label: '畳の長辺（約 180 cm）', cm: 180 },
  ],
  height: [
    { label: 'ドア（約 200 cm）', cm: 200 },
    { label: '机（約 70 cm）', cm: 70 },
    { label: '棚・チェスト', cm: null },
  ],
};

const HINTS = {
  width: '両端とも床の上に置いてください。床の上を奥へまっすぐ伸びる線は高さと見分けられないので、横向きの線を選ぶと確実です。',
  height: '下の端は、その物が床に着いている所に置いてください。',
};

export function createScalePanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'floor-fit';

  const head = document.createElement('div');
  head.className = 'edit__head';
  const title = document.createElement('span');
  title.className = 'edit__title';
  title.textContent = '寸法を合わせる';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'button is-small';
  done.textContent = '完了';
  done.addEventListener('click', () => setScaling(false));
  head.append(title, done);

  const guide = document.createElement('p');
  guide.className = 'floor-fit__guide';
  guide.textContent = '長さが分かる物に、オレンジの線の両端を合わせてください。';

  // 幅と高さの切り替え。いま読んでいる方を選んだ姿にする
  const kindBar = document.createElement('div');
  kindBar.className = 'seg';
  kindBar.setAttribute('role', 'group');
  kindBar.setAttribute('aria-label', '線の読み方');
  const kindButtons = (['width', 'height'] as const).map((kind) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'seg__item';
    button.textContent = kind === 'width' ? '幅（床の上の長さ）' : '高さ（床からの高さ）';
    button.addEventListener('click', () => updateScaleLine({ kind }));
    kindBar.append(button);
    return { kind, button };
  });
  const kindNote = document.createElement('p');
  kindNote.className = 'hint scale__kind-note';
  const autoButton = document.createElement('button');
  autoButton.type = 'button';
  autoButton.className = 'button is-text is-small';
  autoButton.textContent = '自動に戻す';
  autoButton.addEventListener('click', () => updateScaleLine({ kind: 'auto' }));
  const kindRow = document.createElement('div');
  kindRow.className = 'scale__kind-row';
  kindRow.append(kindNote, autoButton);

  const examples = document.createElement('div');
  examples.className = 'scale__examples';

  const lengthField = document.createElement('div');
  lengthField.className = 'field';
  const lengthLabel = document.createElement('label');
  lengthLabel.className = 'field__label';
  lengthLabel.htmlFor = 'scale-length';
  const inline = document.createElement('div');
  inline.className = 'field__inline';
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'decimal';
  input.id = 'scale-length';
  input.className = 'field__input field__input--short';
  input.placeholder = '例: 120';
  input.min = String(LENGTH_LIMITS.min);
  input.max = String(LENGTH_LIMITS.max);
  const unit = document.createElement('span');
  unit.textContent = 'cm';
  inline.append(input, unit);
  const hint = document.createElement('p');
  hint.className = 'hint';
  const error = document.createElement('p');
  error.className = 'hint is-error';
  error.textContent = 'この線では測れません。端が床の上に来るように動かしてください。';
  lengthField.append(lengthLabel, inline, hint, error);

  input.addEventListener('change', () => {
    const centimetres = Number(input.value);
    const valid =
      input.value.trim() !== '' && Number.isFinite(centimetres) && centimetres >= LENGTH_LIMITS.min && centimetres <= LENGTH_LIMITS.max;
    // 空にしたら長さを外す（立って撮った高さに戻る）
    updateScaleLine({ length: valid ? centimetres / 100 : null });
  });

  // やり直し。線を元の位置に戻し、長さも消す
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'button is-quiet is-small';
  reset.textContent = '元に戻す';
  reset.addEventListener('click', resetScale);
  const footer = document.createElement('div');
  footer.className = 'edit__actions';
  footer.append(reset);

  panel.append(head, guide, kindBar, kindRow, examples, lengthField, footer);

  /** いま出している例の種類。変わったときだけ作り直す */
  let shownKind: 'width' | 'height' | null = null;

  function render(): void {
    const { isScaling, scaleLine } = photoState.get();
    panel.hidden = !isScaling;
    if (!isScaling || !scaleLine) return;
    const kind = currentScaleKind();
    for (const { kind: value, button } of kindButtons) {
      const active = value === kind;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    kindNote.textContent = scaleLine.kind === 'auto' ? '線の向きから自動で選んでいます' : '手で選んでいます';
    autoButton.hidden = scaleLine.kind === 'auto';
    lengthLabel.textContent = kind === 'height' ? '線の高さ' : '線の長さ';
    hint.textContent = HINTS[kind];
    if (shownKind !== kind) {
      shownKind = kind;
      examples.replaceChildren(
        ...EXAMPLES[kind].map(({ label, cm }) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'scale__example';
          chip.textContent = label;
          // だいたいの長さが決まっている物は、押すとその長さが入る
          if (cm !== null) chip.addEventListener('click', () => updateScaleLine({ length: cm / 100 }));
          else chip.disabled = true;
          return chip;
        })
      );
    }
    // 打ち込んでいる最中は書き戻さない（入力が消える）
    if (document.activeElement !== input) input.value = scaleLine.length ? String(Math.round(scaleLine.length * 100)) : '';
    error.hidden = !scaleUnmeasurable();
  }
  render();
  photoState.subscribe(render);

  return panel;
}
