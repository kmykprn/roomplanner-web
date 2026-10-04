/**
 * 写真モードで、写真の右上に重ねる［⋯］。押すと背景の操作のメニューが下から出る。
 *
 *   背景の画像を変更                  … 画像を選び直す
 *   拡大・縮小                        … ui/framePanel.ts（下のパネルに出す。ui/photoPanel.ts）
 *   寸法                              … ui/scalePanel.ts
 *   家具を隠す範囲                    … ui/maskPanel.ts
 *   背景の画像を外す                  … 赤い文字（取り消せない）
 *
 * **背景の操作はタブにせず、写真の上に置く。** 前は下のパネルに「背景」タブがあり、そこに［背景の画像を変更］と［✎ 編集］を並べていた。
 * どれも写真を選んだ直後か、うまく合わないときにだけ使う操作なので、いつもタブを 1 つ取るほどではない。
 * 写真の上に置けば、写真の操作だと見て分かる。
 *
 * 写真があるときだけ出す（写真が無ければメニューの操作はどれも使えない。写真を選ぶのは画面の真ん中の案内、ui/photoEmpty.ts）。
 * 写真を読み込んでいる間と、拡大・縮小などの画面に入っている間も出さない。
 * 押せるのは丸の部分だけ。まわりの指の操作（家具のドラッグ）は下のキャンバスに通す
 */

import { isPhotoMode, modeState } from '@/core/mode';
import {
  clearBackground,
  photoState,
  setBackground,
  setFramingPhoto,
  setMasking,
  setScaling,
} from '@/core/photoState';
import { pickImage } from '@/platform/picker';
import { createIcon, type IconName } from '@/ui/icons';

interface MenuItem {
  icon: IconName;
  label: string;
  run(): void;
  /** 取り消せない操作。赤い文字にする */
  danger?: boolean;
}

export function createPhotoMenu(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'photo-menu';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'photo-menu__button';
  button.setAttribute('aria-label', '背景の編集');
  button.append(createIcon('more'));

  const menu = createMenu([
    {
      icon: 'image',
      label: '背景の画像を変更',
      run: async () => {
        const file = await pickImage();
        if (file) await setBackground(file);
      },
    },
    { icon: 'frame', label: '拡大・縮小', run: () => setFramingPhoto(true) },
    { icon: 'ruler', label: '寸法', run: () => setScaling(true) },
    { icon: 'layers', label: '家具を隠す範囲', run: () => setMasking(true) },
    { icon: 'trash', label: '背景の画像を外す', run: clearBackground, danger: true },
  ]);
  button.addEventListener('click', menu.open);

  element.append(button, menu.element);

  function render(): void {
    const { backgroundStatus, isMasking, isScaling, isFramingPhoto } = photoState.get();
    const shown = isPhotoMode() && backgroundStatus === 'ready' && !isMasking && !isScaling && !isFramingPhoto;
    button.hidden = !shown;
    if (!shown) menu.close();
  }

  render();
  photoState.subscribe(render);
  modeState.subscribe(render);
  return element;
}

/** ［⋯］で下から出るメニュー。外側を押すか、項目を選ぶと閉じる */
function createMenu(items: MenuItem[]): { element: HTMLElement; open(): void; close(): void } {
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
    // 閉じてから選んだことをする。先に閉じないと、調整する画面の上にメニューが残る
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
