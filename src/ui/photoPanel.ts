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
import { createFloorPanel } from '@/ui/floorPanel';
import { DEFAULT_FLOOR_FIT } from '@/core/floorFit';
import type { CalibrationStatus } from '@/core/photoState';
import {
  clearBackground,
  photoState,
  retryCalibration,
  setBackground,
  setFittingFloor,
  setMasking,
} from '@/core/photoState';

/** 写真がまだ無いときの案内 */
const IDLE_MESSAGE = '部屋の写真を選ぶと、その上に家具を置けます';
/** 形式と大きさのどちらでも起こる。利用者にできることを先に出す。キャンバスの案内（ui/photoEmpty.ts）も使う */
export const FAILED_MESSAGE = '写真を読み込めませんでした。別の写真をお試しください';
const MASK_NOTE = '指でなぞった部分は、家具よりも手前に表示されます';
/** 写真からの自動調整の様子。度数は出さない（床の傾きと同じ理由） */
const CALIBRATION_LABELS: Record<CalibrationStatus, string> = {
  idle: '未実行',
  running: '解析中…',
  done: '済み',
  failed: 'できませんでした',
};

export function createPhotoPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'photo';

  /** 通常の姿。2 つの行と、その下の一言 */
  const normal = document.createElement('div');
  normal.className = 'photo__normal';
  /** 手前の範囲を指定する姿 */
  const mask = createMaskPanel();
  /** 床に合わせる姿 */
  const floor = createFloorPanel();

  // --- 背景の画像 ---
  const photoRow = createSettingRow('部屋の写真');
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
  const maskRow = createSettingRow('手前にする部分', () => setMasking(true));
  const chevron = document.createElement('span');
  chevron.className = 'setting__chevron';
  chevron.textContent = '›';
  maskRow.element.append(chevron);

  // --- 写真からの自動調整。結果は「床に合わせる」に入る ---
  const calibRow = createSettingRow('写真から自動で合わせる');
  const retryButton = createSmallButton('やり直す', retryCalibration);
  calibRow.element.append(retryButton);

  // --- 床に合わせる（傾きと大きさの基準）。行ごと押せる ---
  const floorRow = createSettingRow('床に合わせる', () => setFittingFloor(true));
  const floorChevron = document.createElement('span');
  floorChevron.className = 'setting__chevron';
  floorChevron.textContent = '›';
  floorRow.element.append(floorChevron);

  /** 行の下の一言。案内・読み込みの失敗・手前の範囲の説明を、状況に応じて 1 つだけ出す */
  const note = document.createElement('p');
  note.className = 'hint photo__note';

  normal.append(photoRow.element, calibRow.element, floorRow.element, maskRow.element, note);
  panel.append(normal, floor, mask);

  function render(): void {
    const {
      backgroundName, backgroundStatus, isMasking, isFittingFloor, maskUrl, floorFit, calibration,
      floorCorners, scaleLength,
    } = photoState.get();
    const ready = backgroundStatus === 'ready';
    const loading = backgroundStatus === 'loading';
    const failed = backgroundStatus === 'failed';

    photoRow.setValue(
      loading ? '読み込み中…' : ready && backgroundName ? backgroundName : '未選択'
    );
    pickButton.textContent = ready ? '変更' : '選ぶ';
    // 読み込み中に押させると、どちらが背景になるのか分からなくなる
    pickButton.disabled = loading;
    clearButton.hidden = !ready;

    calibRow.element.hidden = !ready;
    calibRow.setValue(CALIBRATION_LABELS[calibration], calibration === 'done');
    // 解析中はもう一度押させない。済んだあとは、手で崩したときに戻す手段として残す
    retryButton.hidden = calibration === 'running';

    floorRow.element.hidden = !ready;
    // 度数は出さない。「何度が正しいか」は誰にも分からないので、合わせたかどうかだけ伝える
    const fitted =
      floorCorners !== null ||
      floorFit.pitchDeg !== DEFAULT_FLOOR_FIT.pitchDeg ||
      floorFit.rollDeg !== DEFAULT_FLOOR_FIT.rollDeg;
    // 長さまで入れていれば大きさも合っている。そこまで分かるように言い分ける
    floorRow.setValue(scaleLength ? '大きさも調整済み' : fitted ? '調整済み' : '未調整', fitted);

    maskRow.element.hidden = !ready;
    maskRow.setValue(maskUrl ? '設定済み' : '未設定', Boolean(maskUrl));

    note.classList.toggle('is-error', failed);
    note.textContent = failed ? FAILED_MESSAGE : !ready ? IDLE_MESSAGE : maskUrl ? '' : MASK_NOTE;
    note.hidden = note.textContent === '';

    // どちらかの姿に入っている間は、通常の行を引っ込める
    normal.hidden = isMasking || isFittingFloor;
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
