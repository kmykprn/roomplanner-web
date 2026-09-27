/**
 * 写真モードの「背景」タブ。
 *
 *   背景の画像のカード … 小さな画像、いまの状態の一言、「選ぶ／変更」「外す」
 *   背景の調整         … 3 つのタイル。押すとその場で調整する姿に切り替わり、「完了」で戻る
 *       拡大・縮小                     … ui/framePanel.ts
 *       寸法                           … ui/scalePanel.ts
 *       家具より手前に表示する範囲       … ui/maskPanel.ts
 *
 * 室内の寸法の計算（傾き・画角・奥行き）は寸法の画面のボタンで行う。カードの一言は、
 * その計算が済んでいるかどうかだけを伝える。
 *
 * 画像の取得は platform/picker.ts 越しに行う。
 * Capacitor で iOS アプリにするとき、差し替えるのはあちらの中身だけで済む。
 */

import { pickImage } from '@/platform/picker';
import { createMaskPanel } from '@/ui/maskPanel';
import { createScalePanel } from '@/ui/scalePanel';
import { createFramePanel } from '@/ui/framePanel';
import { createIcon, type IconName } from '@/ui/icons';
import type { MeasureState } from '@/core/photoState';
import {
  clearBackground,
  photoState,
  setBackground,
  setFramingPhoto,
  setMasking,
  setScaling,
} from '@/core/photoState';

/** 背景の画像がまだ無いときの案内。キャンバスの案内（ui/photoEmpty.ts）も使う */
export const IDLE_MESSAGE = '選択した画像の上に家具を置くことができます';
/** 形式と大きさのどちらでも起こる。利用者にできることを先に出す。キャンバスの案内も使う */
export const FAILED_MESSAGE = '背景の画像を読み込めませんでした。別の画像をお試しください';
/** 室内の寸法の計算の様子（カードの一言） */
const MEASURE_NOTES: Record<MeasureState['status'], string> = {
  idle: '室内の寸法はまだ計算していません',
  running: '室内の寸法を計算しています',
  done: '室内の寸法を計算しました',
  failed: '室内の寸法を計算できませんでした',
};

export function createPhotoPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'photo';

  /** 通常の姿。カード・タイル・一言 */
  const normal = document.createElement('div');
  normal.className = 'photo__normal';
  /** 家具より手前に表示する範囲を指定する姿 */
  const mask = createMaskPanel();
  /** 寸法を合わせる姿 */
  const scale = createScalePanel();
  /** 拡大・縮小する姿 */
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

  // --- 背景の調整: 3 つのタイル ---
  const heading = document.createElement('p');
  heading.className = 'bg-heading';
  heading.textContent = '背景の調整';
  const tiles = document.createElement('div');
  tiles.className = 'bg-tiles';
  const frameTile = createTile('frame', '拡大・縮小', () => setFramingPhoto(true));
  const scaleTile = createTile('ruler', '寸法', () => setScaling(true));
  const maskTile = createTile('layers', '家具より手前に\n表示する範囲', () => setMasking(true));
  tiles.append(frameTile.element, scaleTile.element, maskTile.element);

  /** 下の一言。案内・読み込みの失敗を、状況に応じて 1 つだけ出す */
  const note = document.createElement('p');
  note.className = 'hint photo__note';

  normal.append(card, heading, tiles, note);
  panel.append(normal, frame, scale, mask);

  function render(): void {
    const { backgroundUrl, backgroundStatus, isMasking, isScaling, isFramingPhoto, maskUrl, measure, scaleLine } =
      photoState.get();
    const ready = backgroundStatus === 'ready';
    const loading = backgroundStatus === 'loading';
    const failed = backgroundStatus === 'failed';

    thumb.style.backgroundImage = ready && backgroundUrl ? `url("${backgroundUrl}")` : '';
    thumb.classList.toggle('is-empty', !ready);
    cardNote.textContent = loading ? '読み込み中…' : ready ? MEASURE_NOTES[measure.status] : '未選択';
    cardNote.classList.toggle('is-error', ready && measure.status === 'failed');
    pickButton.textContent = ready ? '変更' : '選ぶ';
    // 読み込み中に押させると、どちらが背景になるのか分からなくなる
    pickButton.disabled = loading;
    clearButton.hidden = !ready;

    heading.hidden = !ready;
    tiles.hidden = !ready;
    // 拡大・縮小はいまの状態を言葉にしにくい（倍率の数字も伝わらない）ので、何も出さない。
    // 背景の画像そのものが答えになっている
    frameTile.setValue('', false);
    const length = scaleLine?.length;
    scaleTile.setValue(length ? `${Math.round(length * 100)} cm で調整済み` : '未設定', Boolean(length));
    maskTile.setValue(maskUrl ? '設定済み' : '未設定', Boolean(maskUrl));

    note.classList.toggle('is-error', failed);
    note.textContent = failed ? FAILED_MESSAGE : !ready ? IDLE_MESSAGE : '';
    note.hidden = note.textContent === '';

    // どれかの姿に入っている間は、通常の姿を引っ込める
    normal.hidden = isMasking || isScaling || isFramingPhoto;
    mask.hidden = !isMasking;
  }

  render();
  photoState.subscribe(render);

  return panel;
}

/** 「背景の調整」のタイル。アイコン・見出し・いまの設定。押すと調整する姿に入る */
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
