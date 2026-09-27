/**
 * 写真モードの「背景」タブ。
 *
 *   背景の画像のカード … 小さな画像、いまの状態の一言、「選ぶ／変更」「外す」
 *   背景に合わせる     … 3 つのタイル。押すとその場で調整する姿に切り替わり、「完了」で戻る
 *       表示範囲                       … ui/framePanel.ts
 *       大きさ                         … ui/scalePanel.ts
 *       家具より手前に表示する範囲       … ui/maskPanel.ts
 *
 * 背景の画像の解析（家具の傾きを出す）は利用者が触るものではないので、行を持たない。
 * 解析している間はカードの一言で知らせ、失敗したときだけ「やり直す」を出す。
 *
 * 画像の取得は platform/picker.ts 越しに行う。
 * Capacitor で iOS アプリにするとき、差し替えるのはあちらの中身だけで済む。
 */

import { pickImage } from '@/platform/picker';
import { createMaskPanel } from '@/ui/maskPanel';
import { createScalePanel } from '@/ui/scalePanel';
import { createFramePanel } from '@/ui/framePanel';
import { createIcon, type IconName } from '@/ui/icons';
import type { CalibrationStatus } from '@/core/photoState';
import {
  clearBackground,
  photoState,
  retryCalibration,
  setBackground,
  setFramingPhoto,
  setMasking,
  setScaling,
} from '@/core/photoState';

/** 背景の画像がまだ無いときの案内。キャンバスの案内（ui/photoEmpty.ts）も使う */
export const IDLE_MESSAGE = '選択した画像の上に家具を置くことができます';
/** 形式と大きさのどちらでも起こる。利用者にできることを先に出す。キャンバスの案内も使う */
export const FAILED_MESSAGE = '背景の画像を読み込めませんでした。別の画像をお試しください';
/** 解析の様子（カードの一言）。度数は出さない */
const CALIBRATION_NOTES: Record<CalibrationStatus, string> = {
  idle: '背景に合わせて家具の傾きを計算しています',
  running: '背景に合わせて家具の傾きを計算しています',
  done: '背景に合わせて家具の傾きを計算しました',
  failed: '家具の傾きを計算できませんでした',
};
const SCALE_NOTE = '大きさを合わせると、家具が背景の中の物と同じ縮尺で表示されます';

export function createPhotoPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'photo';

  /** 通常の姿。カード・タイル・一言 */
  const normal = document.createElement('div');
  normal.className = 'photo__normal';
  /** 家具より手前に表示する範囲を指定する姿 */
  const mask = createMaskPanel();
  /** 大きさを合わせる姿 */
  const scale = createScalePanel();
  /** 表示範囲を決める姿 */
  const frame = createFramePanel();

  // --- 背景の画像のカード ---
  const card = document.createElement('div');
  card.className = 'bg-card';
  const thumb = document.createElement('span');
  thumb.className = 'bg-card__thumb';
  const text = document.createElement('div');
  text.className = 'bg-card__text';
  const cardTitle = document.createElement('span');
  cardTitle.className = 'bg-card__title';
  cardTitle.textContent = '背景の画像';
  const cardNote = document.createElement('span');
  cardNote.className = 'bg-card__note';
  text.append(cardTitle, cardNote);
  const pickButton = createSmallButton('選ぶ', async () => {
    const file = await pickImage();
    if (file) await setBackground(file);
  });
  const clearButton = createSmallButton('外す', clearBackground);
  const cardButtons = document.createElement('span');
  cardButtons.className = 'setting__buttons';
  cardButtons.append(pickButton, clearButton);
  card.append(thumb, text, cardButtons);

  // 解析に失敗したときだけ出す帯。何が起きたかはカードの一言が言うので、ここはどうすればよいかだけ
  const failure = document.createElement('div');
  failure.className = 'bg-failure';
  const failureText = document.createElement('span');
  failureText.textContent = 'もう一度お試しいただくか、別の画像を選んでください';
  failure.append(failureText, createSmallButton('やり直す', retryCalibration));

  // --- 背景に合わせる: 3 つのタイル ---
  const heading = document.createElement('p');
  heading.className = 'bg-heading';
  heading.textContent = '背景に合わせる';
  const tiles = document.createElement('div');
  tiles.className = 'bg-tiles';
  const frameTile = createTile('frame', '表示範囲', () => setFramingPhoto(true));
  const scaleTile = createTile('ruler', '大きさ', () => setScaling(true));
  const maskTile = createTile('layers', '家具より手前に\n表示する範囲', () => setMasking(true));
  tiles.append(frameTile.element, scaleTile.element, maskTile.element);

  /** 下の一言。案内・読み込みの失敗・大きさの意味を、状況に応じて 1 つだけ出す */
  const note = document.createElement('p');
  note.className = 'hint photo__note';

  normal.append(card, failure, heading, tiles, note);
  panel.append(normal, frame, scale, mask);

  function render(): void {
    const { backgroundUrl, backgroundStatus, isMasking, isScaling, isFramingPhoto, maskUrl, calibration, scaleLine, view } =
      photoState.get();
    const ready = backgroundStatus === 'ready';
    const loading = backgroundStatus === 'loading';
    const failed = backgroundStatus === 'failed';

    thumb.style.backgroundImage = ready && backgroundUrl ? `url("${backgroundUrl}")` : '';
    thumb.classList.toggle('is-empty', !ready);
    cardNote.textContent = loading ? '読み込み中…' : ready ? CALIBRATION_NOTES[calibration] : '未選択';
    cardNote.classList.toggle('is-error', ready && calibration === 'failed');
    pickButton.textContent = ready ? '変更' : '選ぶ';
    // 読み込み中に押させると、どちらが背景になるのか分からなくなる
    pickButton.disabled = loading;
    clearButton.hidden = !ready;
    failure.hidden = !(ready && calibration === 'failed');

    heading.hidden = !ready;
    tiles.hidden = !ready;
    frameTile.setValue(view.scale < 1 ? '全体' : view.scale > 1 ? '拡大' : '画面いっぱい', false);
    const length = scaleLine?.length;
    scaleTile.setValue(length ? `${Math.round(length * 100)} cm で調整済み` : '未設定', Boolean(length));
    maskTile.setValue(maskUrl ? '設定済み' : '未設定', Boolean(maskUrl));

    note.classList.toggle('is-error', failed);
    note.textContent = failed ? FAILED_MESSAGE : !ready ? IDLE_MESSAGE : length ? '' : SCALE_NOTE;
    note.hidden = note.textContent === '';

    // どれかの姿に入っている間は、通常の姿を引っ込める
    normal.hidden = isMasking || isScaling || isFramingPhoto;
    mask.hidden = !isMasking;
  }

  render();
  photoState.subscribe(render);

  return panel;
}

/** 「背景に合わせる」のタイル。アイコン・見出し・いまの設定。押すと調整する姿に入る */
function createTile(
  icon: IconName,
  label: string,
  onClick: () => void
): { element: HTMLButtonElement; setValue(text: string, emphasized: boolean): void } {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'bg-tile';
  element.addEventListener('click', onClick);
  const iconBox = document.createElement('span');
  iconBox.className = 'bg-tile__icon';
  iconBox.append(createIcon(icon));
  const title = document.createElement('span');
  title.className = 'bg-tile__label';
  title.textContent = label;
  const value = document.createElement('span');
  value.className = 'bg-tile__value';
  element.append(iconBox, title, value);
  return {
    element,
    setValue: (text, emphasized) => {
      value.textContent = text;
      // 設定済みだけ主の色にして、済んでいることを目に留まるようにする
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
