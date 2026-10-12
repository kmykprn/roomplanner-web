/**
 * 画面の下の帯。画面を移る操作（戻る・作る・タブ）はヘッダーではなくここに置き、画面をまたいで同じ見た目にする。
 *
 *   左   … ←（戻る）か、タブ
 *   真ん中 … 黄緑の丸い ＋（主な操作。新しい家具・新しく作る・家具を追加）
 *   右   … タブ（無ければ空）
 *
 * ホーム（背景・部屋のタブ、＋、家具のタブ）、家具のページ（←、＋）、編集の画面（←、＋）で使う
 */

import { createIcon, type IconName } from '@/ui/icons';

export interface FooterBar {
  element: HTMLElement;
  left: HTMLElement;
  center: HTMLElement;
  right: HTMLElement;
}

export function createFooterBar(label: string): FooterBar {
  const element = document.createElement('nav');
  element.className = 'foot';
  element.setAttribute('aria-label', label);
  const left = document.createElement('div');
  left.className = 'foot__side';
  const center = document.createElement('div');
  center.className = 'foot__center';
  const right = document.createElement('div');
  right.className = 'foot__side';
  element.append(left, center, right);
  return { element, left, center, right };
}

/** 左端の ←。線は 32px、押せる範囲は 64px */
export function createFootBack(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'foot__back';
  button.setAttribute('aria-label', label);
  button.append(createIcon('arrow-left'));
  button.addEventListener('click', onClick);
  return button;
}

/** 真ん中の黄緑の丸い ＋（64px）。文字は付けない */
export function createFootAdd(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'foot__add';
  button.setAttribute('aria-label', label);
  button.append(createIcon('plus'));
  button.addEventListener('click', onClick);
  return button;
}

/** タブ。アイコンと文字。選んでいる側は is-active */
export function createFootTab(icon: IconName, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'foot__tab';
  button.append(createIcon(icon), Object.assign(document.createElement('span'), { textContent: label }));
  button.addEventListener('click', onClick);
  return button;
}
