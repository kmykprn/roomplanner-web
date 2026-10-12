/**
 * 下から出る、題と行だけのメニュー。後ろを暗くし、暗い所を押すと閉じる（× とつまみは無し）。
 * 行はアイコン・文字・右の「›」。ホームの ＋（新しい背景 / 新しい部屋）で使う
 */

import { createIcon, type IconName } from '@/ui/icons';

export interface PopupMenuItem {
  icon: IconName;
  label: string;
  run(): void;
}

export interface PopupMenu {
  element: HTMLElement;
  open(): void;
  close(): void;
}

export function createPopupMenu(title: string, items: PopupMenuItem[]): PopupMenu {
  const element = document.createElement('div');
  element.className = 'popup';
  element.hidden = true;
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-label', title);
  const dim = document.createElement('div');
  dim.className = 'popup__dim';
  dim.addEventListener('click', close);
  const sheet = document.createElement('div');
  sheet.className = 'popup__sheet';
  const heading = document.createElement('p');
  heading.className = 'popup__title';
  heading.textContent = title;
  const rows = document.createElement('div');
  rows.className = 'popup__rows';
  for (const item of items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'popup__row';
    const label = document.createElement('span');
    label.textContent = item.label;
    const chevron = document.createElement('span');
    chevron.className = 'popup__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    row.append(createIcon(item.icon), label, chevron);
    row.addEventListener('click', () => {
      close();
      item.run();
    });
    rows.append(row);
  }
  sheet.append(heading, rows);
  element.append(dim, sheet);

  function close(): void {
    element.hidden = true;
  }
  return {
    element,
    open() {
      element.hidden = false;
    },
    close,
  };
}
