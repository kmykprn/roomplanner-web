/**
 * 家具のページ。下のタブの「家具」を押すと、画面全体に開く。
 *
 * **写真や部屋とは別のページにする。** 家具の一覧・追加・3D を作る・編集は、どれも縦に長い。
 * 下のパネルの中では 1〜2 列しか見えず、家具が増えるとスクロールばかりになった。
 * ページの中身は家具タブだったもの（modelPanel）をそのまま使い、上に「×」と見出しだけを足す。
 * 「×」で閉じると、写真（部屋）と 3 つのタブの画面に戻る
 */

export interface FurniturePage {
  element: HTMLElement;
  open(): void;
  close(): void;
}

export function createFurniturePage(content: HTMLElement, onClose: () => void): FurniturePage {
  const element = document.createElement('div');
  element.className = 'page';
  element.hidden = true;
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-label', '家具');

  const bar = document.createElement('div');
  bar.className = 'page__bar';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'page__close';
  close.setAttribute('aria-label', '閉じる');
  close.append(createCloseIcon());
  close.addEventListener('click', onClose);
  const title = document.createElement('span');
  title.className = 'page__title';
  title.textContent = '家具';
  bar.append(close, title);

  const body = document.createElement('div');
  body.className = 'page__body';
  body.append(content);
  element.append(bar, body);

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

/** 「×」の記号。線の太さと端の丸みを、ほかの線のアイコンにそろえる */
function createCloseIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M6 6 L18 18 M18 6 L6 18');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2.2');
  path.setAttribute('stroke-linecap', 'round');
  svg.append(path);
  return svg;
}
