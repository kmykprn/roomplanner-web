/**
 * 写真モードの「背景」タブ。
 *
 *   1 行目   … ［背景の画像を選ぶ／変更］
 *   2 行目   … ［✎ 編集］。背景の画像があるときだけ出す。読み込みに失敗したときだけ、その下に一言
 *   ［✎ 編集］… 押すと下から出るメニュー
 *       拡大・縮小                     … ui/framePanel.ts
 *       寸法                           … ui/scalePanel.ts
 *       家具より手前に表示する範囲       … ui/maskPanel.ts
 *       背景の画像を外す
 *
 * **ふだん使わない操作は［✎ 編集］のメニューにしまう。** 前は［⋯］だったが、文字が無く、何ができるか分からなかった。
 * 拡大・縮小・寸法・手前に表示する範囲は、
 * 写真を選んだ直後か、自動の推定がうまく合わないときにだけ使う。常に並べておくと、いちばん使う「変更」が埋もれる。
 * 背景の画像の小さな見本も出さない（写真そのものが上に大きく出ている）。
 * 室内の寸法を計算したかどうかも出さない（利用者の次の行動に関係しない）。
 *
 * 画像の取得は platform/picker.ts 越しに行う。
 * Capacitor で iOS アプリにするとき、差し替えるのはあちらの中身だけで済む。
 */

import { pickImage } from '@/platform/picker';
import { createMaskPanel } from '@/ui/maskPanel';
import { createScalePanel } from '@/ui/scalePanel';
import { createFramePanel } from '@/ui/framePanel';
import { createIcon, type IconName } from '@/ui/icons';
import {
  clearBackground,
  photoState,
  setBackground,
  setFramingPhoto,
  setMasking,
  setScaling,
} from '@/core/photoState';

/** 背景の画像がまだ無いときの案内。キャンバスの案内（ui/photoEmpty.ts）が使う */
export const IDLE_MESSAGE = '選択した画像の上に家具を置くことができます';
/** 形式と大きさのどちらでも起こる。利用者にできることを先に出す。キャンバスの案内も使う */
export const FAILED_MESSAGE = '背景の画像を読み込めませんでした。別の画像をお試しください';

export function createPhotoPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'photo';

  /** 通常の姿。1 行と一言 */
  const normal = document.createElement('div');
  normal.className = 'photo__normal';
  /** 家具より手前に表示する範囲を指定する姿 */
  const mask = createMaskPanel();
  /** 寸法を合わせる姿 */
  const scale = createScalePanel();
  /** 拡大・縮小する姿 */
  const frame = createFramePanel();

  // --- 1 行目に［選ぶ／変更］、2 行目に［✎ 編集］ ---
  const row = document.createElement('div');
  row.className = 'bg-row';
  const pickButton = document.createElement('button');
  pickButton.type = 'button';
  pickButton.className = 'button bg-row__pick';
  pickButton.addEventListener('click', async () => {
    const file = await pickImage();
    if (file) await setBackground(file);
  });
  const menu = createBackgroundMenu([
    { icon: 'frame', label: '拡大・縮小', run: () => setFramingPhoto(true) },
    { icon: 'ruler', label: '寸法', run: () => setScaling(true) },
    { icon: 'layers', label: '家具より手前に表示する範囲', run: () => setMasking(true) },
    { icon: 'trash', label: '背景の画像を外す', run: clearBackground, danger: true },
  ]);
  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.className = 'bg-row__edit';
  const editLabel = document.createElement('span');
  editLabel.textContent = '編集';
  editButton.append(createIcon('pencil'), editLabel);
  editButton.addEventListener('click', menu.open);
  row.append(pickButton, editButton);

  /** 読み込みに失敗したときの一言 */
  const note = document.createElement('p');
  note.className = 'hint photo__note is-error';
  note.textContent = FAILED_MESSAGE;

  normal.append(row, note);
  panel.append(normal, frame, scale, mask, menu.element);

  function render(): void {
    const { backgroundStatus, isMasking, isScaling, isFramingPhoto } = photoState.get();
    const ready = backgroundStatus === 'ready';
    const loading = backgroundStatus === 'loading';

    pickButton.textContent = loading ? '読み込み中…' : ready ? '背景の画像を変更' : '背景の画像を選ぶ';
    // 読み込み中に押させると、どちらが背景になるのか分からなくなる
    pickButton.disabled = loading;
    // 背景の画像が無いと、メニューの操作はどれも使えない
    editButton.hidden = !ready;
    if (!ready) menu.close();
    note.hidden = backgroundStatus !== 'failed';

    // どれかの姿に入っている間は、通常の姿を引っ込める
    normal.hidden = isMasking || isScaling || isFramingPhoto;
    mask.hidden = !isMasking;
  }

  render();
  photoState.subscribe(render);

  return panel;
}

interface MenuItem {
  icon: IconName;
  label: string;
  run(): void;
  /** 取り消せない操作。赤い文字にする */
  danger?: boolean;
}

/** ［✎ 編集］で下から出るメニュー。外側を押すか、項目を選ぶと閉じる */
function createBackgroundMenu(items: MenuItem[]): { element: HTMLElement; open(): void; close(): void } {
  const element = document.createElement('div');
  element.className = 'bg-menu';
  element.hidden = true;
  const dim = document.createElement('div');
  dim.className = 'bg-menu__dim';
  const sheet = document.createElement('div');
  sheet.className = 'bg-menu__sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', '背景の編集');
  const close = (): void => {
    element.hidden = true;
  };
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = item.danger ? 'bg-menu__item is-danger' : 'bg-menu__item';
    const label = document.createElement('span');
    label.textContent = item.label;
    button.append(createIcon(item.icon), label);
    // 閉じてから選んだことをする。先に閉じないと、調整する姿の上にメニューが残る
    button.addEventListener('click', () => {
      close();
      item.run();
    });
    sheet.append(button);
  }
  dim.addEventListener('click', close);
  element.append(dim, sheet);
  return {
    element,
    open: () => {
      element.hidden = false;
    },
    close,
  };
}
