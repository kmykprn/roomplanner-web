/**
 * 「寸法」の画面。写真モードの「背景」タブの「背景の調整」から入る。
 *
 * 背景の画像の上にオレンジの線が 1 本出る（ui/scaleLineOverlay.ts）。利用者はその両端を、
 * 長さの分かる物に合わせ、実際の長さを cm で入れる。そこから背景の縮尺（カメラの高さ）が
 * 決まり、置いた家具が実寸どおりの大きさで写る（core/scaleLine.ts）。
 *
 * 線は「幅」（床の上の長さ）か「高さ」（床から立つ物の高さ）として読む。どちらかは線の向きで
 * 自動で決まり、外れたときは切り替えで直す。家具は隠さないので、長さを入れたその場で
 * 大きさが変わり、自然に見えるかを確かめられる。「戻る」は入ったときの線と長さに戻す。
 */

import {
  currentScaleKind,
  measureRoom,
  photoState,
  resetScale,
  scaleUnmeasurable,
  setScaleLine,
  setScaling,
  updateScaleLine,
} from '@/core/photoState';
import type { ScaleLine } from '@/core/scaleLine';
import { createMeasureStatus } from '@/ui/measureStatus';
import { createQuietButton, createSentences, createSubScreen } from '@/ui/subScreen';

/** 長さとして受け付ける範囲（cm） */
const LENGTH_LIMITS = { min: 5, max: 2000 };

const PURPOSE = '寸法を合わせると、家具が背景の中の物と同じ縮尺で表示されます。';
const STEPS = [
  'オレンジの線の両端を、長さが分かっている物の両端に合わせてください。',
  '合わせた物の実際の長さを、下の欄に入力してください。',
];

export function createScalePanel(): HTMLElement {
  /** 入ったときの線。「戻る」でここに戻す（無かったなら null） */
  let entered: ScaleLine | null | undefined;

  const screen = createSubScreen({
    title: '寸法',
    onBack: () => {
      if (entered !== undefined) setScaleLine(entered);
      setScaling(false);
    },
    onDone: () => setScaling(false),
  });

  // 幅と高さの切り替え。いま読んでいる方を選んだ姿にする
  const kindBar = document.createElement('div');
  kindBar.className = 'seg scale__kind';
  kindBar.setAttribute('role', 'group');
  kindBar.setAttribute('aria-label', '線が表すもの');
  const kindButtons = (['width', 'height'] as const).map((kind) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'seg__item';
    button.textContent = kind === 'width' ? '幅' : '高さ';
    button.addEventListener('click', () => updateScaleLine({ kind }));
    kindBar.append(button);
    return { kind, button };
  });

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
  input.setAttribute('aria-label', '合わせた物の実際の長さ（cm）');
  const unit = document.createElement('span');
  unit.textContent = 'cm';
  inline.append(input, unit);
  input.addEventListener('change', () => {
    const centimetres = Number(input.value);
    const valid =
      input.value.trim() !== '' && Number.isFinite(centimetres) && centimetres >= LENGTH_LIMITS.min && centimetres <= LENGTH_LIMITS.max;
    // 空にしたら長さを外す（立って撮った高さに戻る）
    updateScaleLine({ length: valid ? centimetres / 100 : null });
  });

  const controls = document.createElement('div');
  controls.className = 'scale__controls';
  controls.append(kindBar, inline);

  const error = document.createElement('p');
  error.className = 'hint is-error';
  error.textContent = 'この線では寸法を測ることができません。線の端を床の上に動かしてください。';

  // 室内の寸法の計算。長さを入れてから押してもらう（傾き・画角・奥行きをまとめて出す）
  const measureButton = document.createElement('button');
  measureButton.type = 'button';
  measureButton.className = 'button scale__measure';
  measureButton.textContent = '室内の寸法を計算';
  measureButton.addEventListener('click', () => void measureRoom());
  const measureStatus = createMeasureStatus();

  screen.body.append(
    createSentences([PURPOSE], 'sub__text is-sub'),
    createSentences(STEPS),
    controls,
    error,
    measureButton,
    measureStatus
  );
  // 線を元の位置に戻し、長さも消す
  screen.actions.append(createQuietButton('寸法を解除', resetScale));

  function render(): void {
    const { isScaling, scaleLine } = photoState.get();
    if (isScaling && screen.element.hidden !== false) entered = scaleLine ? { ...scaleLine } : null;
    if (!isScaling) entered = undefined;
    screen.element.hidden = !isScaling;
    if (!isScaling || !scaleLine) return;
    const kind = currentScaleKind();
    for (const { kind: value, button } of kindButtons) {
      const active = value === kind;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    // 打ち込んでいる最中は書き戻さない（入力が消える）
    if (document.activeElement !== input) input.value = scaleLine.length ? String(Math.round(scaleLine.length * 100)) : '';
    error.hidden = !scaleUnmeasurable();
    const { backgroundStatus, measure } = photoState.get();
    measureButton.disabled = backgroundStatus !== 'ready' || !scaleLine.length || measure.status === 'running';
  }
  screen.element.hidden = true;
  render();
  photoState.subscribe(render);

  return screen.element;
}
