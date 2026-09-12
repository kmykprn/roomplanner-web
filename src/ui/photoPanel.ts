/**
 * 写真モードの「背景」タブ。設定画面のような 2 つの行で、背景写真とそれに付くものを扱う。
 *
 *   背景の画像 … ファイル名（または未選択）と、「選ぶ／変える」「外す」
 *   手前の範囲 … 未指定／指定済み。行を押すと、この場で指定する姿（ui/maskPanel.ts）に
 *                切り替わり、「完了」で戻る
 *
 * 手前の範囲は写真に付いているものなので、写真があるときだけ出す。
 * 写真の取得は platform/picker.ts 越しに行う。
 * Capacitor で iOS アプリにするとき、差し替えるのはあちらの中身だけで済む。
 */

import { pickImage } from '@/platform/picker';
import { createMaskPanel } from '@/ui/maskPanel';
import { clearBackground, photoState, setBackground, setMasking } from '@/core/photoState';

/** 写真がまだ無いときの案内 */
const IDLE_MESSAGE = '部屋の写真を選ぶと、その上に3Dモデルを置けます';
/** 形式と大きさのどちらでも起こる。利用者にできることを先に出す */
const FAILED_MESSAGE = '写真を読み込めませんでした。別の写真で試してください';
const MASK_NOTE = '指定した範囲は3Dモデルの手前に表示されます';

export function createPhotoPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'photo';

  /** 通常の姿。2 つの行と、その下の一言 */
  const normal = document.createElement('div');
  normal.className = 'photo__normal';
  /** 手前の範囲を指定する姿 */
  const mask = createMaskPanel();

  // --- 背景の画像 ---
  const photoRow = createSettingRow('背景の画像');
  const pickButton = createSmallButton('選ぶ', async () => {
    const file = await pickImage();
    if (file) await setBackground(file);
  });
  const clearButton = createSmallButton('外す', clearBackground);
  const photoButtons = document.createElement('span');
  photoButtons.className = 'setting__buttons';
  photoButtons.append(pickButton, clearButton);
  photoRow.element.append(photoButtons);

  // --- 手前の範囲。行ごと押せる ---
  const maskRow = createSettingRow('手前の範囲', () => setMasking(true));
  const chevron = document.createElement('span');
  chevron.className = 'setting__chevron';
  chevron.textContent = '›';
  maskRow.element.append(chevron);

  /** 行の下の一言。案内・読み込みの失敗・手前の範囲の説明を、状況に応じて 1 つだけ出す */
  const note = document.createElement('p');
  note.className = 'hint photo__note';

  normal.append(photoRow.element, maskRow.element, note);
  panel.append(normal, mask);

  function render(): void {
    const { backgroundName, backgroundStatus, isMasking, maskUrl } = photoState.get();
    const ready = backgroundStatus === 'ready';
    const loading = backgroundStatus === 'loading';
    const failed = backgroundStatus === 'failed';

    photoRow.setValue(
      loading ? '読み込んでいます…' : ready && backgroundName ? backgroundName : '未選択'
    );
    pickButton.textContent = ready ? '変える' : '選ぶ';
    // 読み込み中に押させると、どちらが背景になるのか分からなくなる
    pickButton.disabled = loading;
    clearButton.hidden = !ready;

    maskRow.element.hidden = !ready;
    maskRow.setValue(maskUrl ? '指定済み' : '未指定', Boolean(maskUrl));

    note.classList.toggle('is-error', failed);
    note.textContent = failed ? FAILED_MESSAGE : !ready ? IDLE_MESSAGE : maskUrl ? '' : MASK_NOTE;
    note.hidden = note.textContent === '';

    // 指定している間は通常の姿を引っ込め、指定する姿だけを出す
    normal.hidden = isMasking;
    mask.hidden = !isMasking;
  }

  render();
  photoState.subscribe(render);

  return panel;
}

/**
 * 「見出し・いまの値・（右端の何か）」の 1 行。
 * onClick を渡すと行ごとボタンになる（手前の範囲）。渡さなければただの行（背景の画像）
 */
function createSettingRow(
  label: string,
  onClick?: () => void
): { element: HTMLElement; setValue(text: string, emphasized?: boolean): void } {
  const element = document.createElement(onClick ? 'button' : 'div');
  element.className = 'setting';
  if (onClick) element.addEventListener('click', onClick);

  const heading = document.createElement('span');
  heading.className = 'setting__label';
  heading.textContent = label;
  const value = document.createElement('span');
  value.className = 'setting__value';
  element.append(heading, value);

  return {
    element,
    setValue: (text, emphasized = false) => {
      value.textContent = text;
      // 「指定済み」だけ主の色にして、済んでいることを目に留まるようにする
      value.classList.toggle('is-set', emphasized);
    },
  };
}

function createSmallButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'button is-quiet is-small';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}
