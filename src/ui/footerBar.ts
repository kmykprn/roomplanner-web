/**
 * 画面の下の帯。画面を移る操作（戻る・作る・タブ）はヘッダーではなくここに置き、画面をまたいで同じ見た目にする。
 *
 *   左   … ←（戻る）か、タブ
 *   真ん中 … 黄緑の丸い ＋（新しく作る）
 *   右   … タブ（無ければ空）
 *
 * ホーム・編集の画面・家具のページ（タブから開いたとき）は、同じ「背景・部屋・＋・家具」の帯（createNavFooter）。
 * 家具のページを「家具を追加」から開いたときだけ、← だけの帯。
 * 「家具を追加」「新しい家具」は帯ではなく、一覧の右下に浮かぶ白い丸（createFloatingAdd）。帯の黄緑の ＋ と見分けるため
 */

import { createIcon, type IconName } from '@/ui/icons';
import { createPopupMenu, type PopupMenu } from '@/ui/popupMenu';

export type SceneKind = 'photo' | 'room';

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

export type NavTab = SceneKind | 'furniture';

export interface NavFooterHandlers {
  /** 「背景」「部屋」を押した */
  onKind(kind: SceneKind): void;
  /** ＋ の「新しく作る」で「新しい背景」「新しい部屋」を選んだ */
  onCreate(kind: SceneKind): void;
  /** 「家具」を押した */
  onFurniture(): void;
}

export interface NavFooter {
  element: HTMLElement;
  /** 「新しく作る」のメニュー。帯を置く画面の入れ物（position のあるもの）に足す */
  menu: PopupMenu;
  /** 選んでいる印を付けるタブ */
  setActive(tab: NavTab): void;
}

/** ホームと同じ帯。左に「背景」「部屋」、真ん中に ＋（新しく作る）、右に「家具」 */
export function createNavFooter(handlers: NavFooterHandlers): NavFooter {
  const foot = createFooterBar('背景・部屋・家具');
  const tabs: Record<NavTab, HTMLButtonElement> = {
    photo: createFootTab('image', '背景', () => handlers.onKind('photo')),
    room: createFootTab('cube', '部屋', () => handlers.onKind('room')),
    furniture: createFootTab('chair', '家具', handlers.onFurniture),
  };
  const menu = createPopupMenu('新しく作る', [
    { icon: 'image', label: '新しい背景', run: () => handlers.onCreate('photo') },
    { icon: 'cube', label: '新しい部屋', run: () => handlers.onCreate('room') },
  ]);
  foot.left.append(tabs.photo, tabs.room);
  foot.center.append(createFootAdd('新しく作る', menu.open));
  foot.right.append(tabs.furniture);
  return {
    element: foot.element,
    menu,
    setActive(tab) {
      for (const [name, button] of Object.entries(tabs)) button.classList.toggle('is-active', name === tab);
    },
  };
}

/**
 * 一覧の右下に浮かぶ、白い地に黄緑の線の丸い ＋（56px）。編集の画面の「家具を追加」と、家具のページの「新しい家具」。
 * 帯の黄緑の塗りの ＋（新しく作る）とは意味が違うので、色と場所で見分ける
 */
export function createFloatingAdd(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'fab';
  button.setAttribute('aria-label', label);
  button.append(createIcon('plus'));
  button.addEventListener('click', onClick);
  return button;
}
