/**
 * 回数券の一覧。「家具を追加」の帯の［購入］で、画面の下から出す。
 *
 * **App Store での購入はまだ作っていない**（残りの作業は docs/todo-purchase.md）。
 * 今は一覧と価格だけを出し、「購入は準備中です」と書く。押しても何も起きないボタンは出さない。
 * 購入を作ったら、アプリ版では各行に買うボタンを付け、Web 版では「アプリで購入できます」と出す。
 * 外側（暗くした所）か［とじる］で閉じる
 */

import { TICKETS } from '@/config/tickets';

export function createTicketSheet(): { element: HTMLElement; open(): void; close(): void } {
  const element = document.createElement('div');
  element.className = 'ticket-sheet';
  element.hidden = true;

  const dim = document.createElement('div');
  dim.className = 'ticket-sheet__dim';

  const sheet = document.createElement('div');
  sheet.className = 'ticket-sheet__sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', '回数券');

  const title = document.createElement('b');
  title.className = 'ticket-sheet__title';
  title.textContent = '回数券';

  const list = document.createElement('ul');
  list.className = 'ticket-sheet__list';
  for (const ticket of TICKETS) {
    const row = document.createElement('li');
    row.className = 'ticket-sheet__row';
    const generations = document.createElement('span');
    generations.className = 'ticket-sheet__generations';
    generations.textContent = `3D 作成 ${ticket.generations} 回`;
    const price = document.createElement('span');
    price.className = 'ticket-sheet__price';
    price.textContent = `${ticket.yen} 円`;
    row.append(generations, price);
    list.append(row);
  }

  const note = document.createElement('p');
  note.className = 'ticket-sheet__note';
  note.textContent = '購入は準備中です。';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'button is-quiet ticket-sheet__close';
  closeButton.textContent = 'とじる';

  sheet.append(title, list, note, closeButton);
  element.append(dim, sheet);

  function close(): void {
    element.hidden = true;
  }
  dim.addEventListener('click', close);
  closeButton.addEventListener('click', close);

  return {
    element,
    open() {
      element.hidden = false;
    },
    close,
  };
}
