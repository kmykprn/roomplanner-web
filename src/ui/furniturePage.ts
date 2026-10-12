/**
 * 家具のページ。下のタブの「家具」や、編集の画面の ＋ を押すと、画面全体に開く。
 *
 * **写真や部屋とは別のページにする。** 家具の一覧・追加・3D を作る・編集は、どれも縦に長い。
 * 下のパネルの中では 1〜2 列しか見えず、家具が増えるとスクロールばかりになった。
 * ページの中身は家具タブだったもの（modelPanel）をそのまま使い、上に見出し、下に共通の帯（ui/footerBar.ts）を足す。
 *
 * 下の帯: 左端に ←、真ん中に黄緑の丸い ＋（新しい家具）。
 * ← は、一覧以外の姿（3D を作る・編集・高さの入力）を開いていればその姿だけ閉じ、一覧ならページを閉じる（onBack で呼ぶ側が決める）。
 * 一覧以外の姿では ＋ を出さない（style.css）
 */

import { createFootAdd, createFootBack, createFooterBar } from '@/ui/footerBar';

export interface FurniturePage {
  element: HTMLElement;
  open(): void;
  close(): void;
}

export interface FurniturePageActions {
  /** ←。開いている姿を 1 つ戻す（一覧ならページを閉じる） */
  onBack(): void;
  /** ＋。新しい家具を作る（「家具を追加」のメニューを開く） */
  onAdd(): void;
}

export function createFurniturePage(content: HTMLElement, { onBack, onAdd }: FurniturePageActions): FurniturePage {
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

  const foot = createFooterBar('戻ると新しい家具');
  foot.left.append(createFootBack('戻る', onBack));
  foot.center.append(createFootAdd('新しい家具', onAdd));

  element.append(bar, body, foot.element);

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
