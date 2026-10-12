/**
 * 家具のページ。下のタブの「家具」や、編集の画面の「家具を追加」を押すと、画面全体に開く。
 *
 * **写真や部屋とは別のページにする。** 家具の一覧・追加・3D を作る・編集は、どれも縦に長い。
 * 下のパネルの中では 1〜2 列しか見えず、家具が増えるとスクロールばかりになった。
 * ページの中身は家具タブだったもの（modelPanel）をそのまま使い、上に見出し（左に ‹）、右下に浮かぶ ＋（新しい家具）を足す。
 *
 * 開き方で変わる（ui/footerBar.ts）。
 *   placing … 編集の画面の「家具を追加」から。ヘッダーの左に ‹（編集の画面と同じ）、下の帯は無い。家具を押すと「背景に追加」（部屋に追加）で置ける
 *   browse  … 下のタブの「家具」から。下の帯はホームと同じ（背景・部屋・＋・家具。「家具」が選ばれた状態）。置き先を開いていないので置くボタンは出ない。
 *              ‹ は一覧以外の姿を開いている間だけ出す（一覧ではタブで移る。style.css）
 * ‹ は、一覧以外の姿（3D を作る・編集・高さの入力）を開いていればその姿だけ閉じ、一覧ならページを閉じる（onBack で呼ぶ側が決める）。
 * 一覧以外の姿では浮かぶ ＋ を出さない（style.css）
 */

import { createFloatingAdd, createNavFooter, type NavFooterHandlers } from '@/ui/footerBar';
import { createIcon } from '@/ui/icons';

export type FurniturePageMode = 'placing' | 'browse';

export interface FurniturePage {
  element: HTMLElement;
  open(mode: FurniturePageMode): void;
  close(): void;
  /** 開いているときの開き方。閉じていれば null */
  mode(): FurniturePageMode | null;
}

export interface FurniturePageActions extends NavFooterHandlers {
  /** ヘッダーの ‹。開いている姿を 1 つ戻す（一覧ならページを閉じる） */
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

  // 見出し。左に ‹（編集の画面のヘッダーと同じ見た目）、真ん中に題
  const bar = document.createElement('div');
  bar.className = 'page__bar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'page__back';
  back.setAttribute('aria-label', '戻る');
  back.append(createIcon('chevron-left'));
  back.addEventListener('click', actions.onBack);
  const title = document.createElement('span');
  title.className = 'page__title';
  title.textContent = '家具';
  bar.append(back, title);

  const body = document.createElement('div');
  body.className = 'page__body';
  body.append(content);

  const navFoot = createNavFooter(actions);
  navFoot.setActive('furniture');

  element.append(bar, body, createFloatingAdd('新しい家具', actions.onAdd), navFoot.element, navFoot.menu.element);

  let current: FurniturePageMode | null = null;

  return {
    element,
    open(mode) {
      current = mode;
      element.classList.toggle('is-browse', mode === 'browse');
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
