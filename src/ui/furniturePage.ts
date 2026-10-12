/**
 * 家具のページ。下のタブの「家具」や、編集の画面の「家具を追加」を押すと、画面全体に開く。
 *
 * **写真や部屋とは別のページにする。** 家具の一覧・追加・3D を作る・編集は、どれも縦に長い。
 * 下のパネルの中では 1〜2 列しか見えず、家具が増えるとスクロールばかりになった。
 * ページの中身は家具タブだったもの（modelPanel）をそのまま使い、上に見出し、下に帯、右下に浮かぶ ＋（新しい家具）を足す。
 *
 * 開き方で下の帯が変わる（ui/footerBar.ts）。
 *   placing … 編集の画面の「家具を追加」から。← だけの帯。家具を押すと「背景に追加」（部屋に追加）で置ける
 *   browse  … 下のタブの「家具」から。ホームと同じ帯（背景・部屋・＋・家具。「家具」が選ばれた状態）。置き先を開いていないので置くボタンは出ない
 * ← は、一覧以外の姿（3D を作る・編集・高さの入力）を開いていればその姿だけ閉じ、一覧ならページを閉じる（onBack で呼ぶ側が決める）。
 * 一覧以外の姿では浮かぶ ＋ を出さない（style.css）
 */

import { createFloatingAdd, createFootBack, createFooterBar, createNavFooter, type NavFooterHandlers } from '@/ui/footerBar';

export type FurniturePageMode = 'placing' | 'browse';

export interface FurniturePage {
  element: HTMLElement;
  open(mode: FurniturePageMode): void;
  close(): void;
  /** 開いているときの開き方。閉じていれば null */
  mode(): FurniturePageMode | null;
}

export interface FurniturePageActions extends NavFooterHandlers {
  /** placing の ←。開いている姿を 1 つ戻す（一覧ならページを閉じる） */
  onBack(): void;
  /** 浮かぶ ＋。新しい家具を作る（「家具を追加」のメニューを開く） */
  onAdd(): void;
}

export function createFurniturePage(content: HTMLElement, actions: FurniturePageActions): FurniturePage {
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

  const backFoot = createFooterBar('戻る');
  backFoot.left.append(createFootBack('戻る', actions.onBack));
  const navFoot = createNavFooter(actions);
  navFoot.setActive('furniture');

  element.append(bar, body, createFloatingAdd('新しい家具', actions.onAdd), backFoot.element, navFoot.element, navFoot.menu.element);

  let current: FurniturePageMode | null = null;

  return {
    element,
    open(mode) {
      current = mode;
      backFoot.element.hidden = mode !== 'placing';
      navFoot.element.hidden = mode !== 'browse';
      element.hidden = false;
    },
    close() {
      navFoot.menu.close();
      current = null;
      element.hidden = true;
    },
    mode: () => current,
  };
}
