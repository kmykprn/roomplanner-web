/**
 * 家具のページ。下のタブの「家具」や、編集の画面の「家具を追加」を押すと、画面全体に開く。
 *
 * **写真や部屋とは別のページにする。** 家具の一覧・追加・3D を作る・編集は、どれも縦に長い。
 * 下のパネルの中では 1〜2 列しか見えず、家具が増えるとスクロールばかりになった。
 * ページの中身は家具タブだったもの（modelPanel）をそのまま使い、上に見出し、下に帯を足す。
 *
 * 下の帯（Chrome の下の帯のような形）: 左端に ←（戻る）、真ん中に黄緑の丸い ＋（新しい家具）。
 * 一覧が長くても、戻ると追加が親指の届く所にある。
 * 一覧以外の姿（3D を作る・編集・高さの入力）を開いている間は、帯を隠す（それぞれに「‹ 戻る」があり、← と二重になるため。style.css）
 */

import { createIcon } from '@/ui/icons';

export interface FurniturePage {
  element: HTMLElement;
  open(): void;
  close(): void;
}

export interface FurniturePageActions {
  /** ←。ページを閉じて元の画面へ */
  onClose(): void;
  /** ＋。新しい家具を作る（「家具を追加」のメニューを開く） */
  onAdd(): void;
}

export function createFurniturePage(content: HTMLElement, { onClose, onAdd }: FurniturePageActions): FurniturePage {
  const element = document.createElement('div');
  element.className = 'page';
  element.hidden = true;
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-label', '家具');

  const bar = document.createElement('div');
  bar.className = 'page__bar';
  const title = document.createElement('span');
  title.className = 'page__title';
  title.textContent = '家具';
  bar.append(title);

  const body = document.createElement('div');
  body.className = 'page__body';
  body.append(content);

  const foot = document.createElement('div');
  foot.className = 'page__foot';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'page__back';
  back.setAttribute('aria-label', '戻る');
  back.append(createIcon('arrow-left'));
  back.addEventListener('click', onClose);
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'page__add';
  add.setAttribute('aria-label', '新しい家具');
  add.append(createIcon('plus'));
  add.addEventListener('click', onAdd);
  foot.append(back, add);

  element.append(bar, body, foot);

  return {
    element,
    open() {
      element.hidden = false;
    },
    close() {
      element.hidden = true;
    },
  };
}
