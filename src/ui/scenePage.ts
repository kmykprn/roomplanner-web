/**
 * 保存した背景と部屋の一覧（ホーム）。アプリを開いたときの最初の画面（背景も部屋も 1 つも無ければ、新しい背景の編集から。main.ts）。
 *
 *   下の帯         … 左に「背景」「部屋」のタブ（どちらの一覧か）、真ん中に黄緑の ＋、右に「家具」（家具のページを上に開く）
 *   ＋             … 「新しく作る」のメニュー（新しい背景 / 新しい部屋）が下から出る。選ぶと作って編集へ。背景の写真は編集の画面で選ぶ
 *   タイル         … 1 行 2 列。押すとそれを開いて編集の画面へ。アイコンは保存したときの画面の縮小、下は名前だけ
 *   タイルの ⋯     … 名前を変える・複製（複製したものを開く）・削除（確認は家具の削除と同じ文言）
 *
 * 上の帯は無い（題は要らず、タブで何の一覧か分かる）。
 * 編集の画面（写真と下のシート）はこのページの下にそのままあり、ページを隠すと見える。
 * 開くものの切り替えとモードの切り替えは呼ぶ側（main.ts）が行う。ここは一覧の表示と、押されたことを伝えるだけ
 */

import {
  deleteScenes,
  duplicateScene,
  entriesOf,
  readSceneThumbnail,
  renameScene,
  sceneLibrary,
  type SceneEntry,
  type SceneKind,
} from '@/core/sceneLibrary';
import { createFootAdd, createFootTab, createFooterBar } from '@/ui/footerBar';
import { createIcon } from '@/ui/icons';
import { askName } from '@/ui/nameDialog';
import { createMenu } from '@/ui/photoMenu';
import { createPopupMenu } from '@/ui/popupMenu';

export interface ScenePage {
  element: HTMLElement;
  /** 一覧を出す。どちらの一覧かを渡す */
  open(kind: SceneKind): void;
  close(): void;
  isOpen(): boolean;
}

export interface ScenePageHandlers {
  /** タイルを押した。開いて編集の画面へ */
  onOpen(entry: SceneEntry): void;
  /** ＋ を押した。新しく作って編集の画面へ */
  onCreate(kind: SceneKind): void;
  /** 下の「家具」タブを押した。家具のページを一覧の上に開く。kind は下のタブで選んでいる種類（置き先になる） */
  onFurniture(kind: SceneKind): void;
}

export function createScenePage(handlers: ScenePageHandlers): ScenePage {
  let kind: SceneKind = 'photo';
  /** アイコンの画像の URL。読んだら覚えておき、消えたものは解放する */
  const thumbnails = new Map<string, string>();

  const element = document.createElement('div');
  element.className = 'scenes';
  element.hidden = true;
  element.setAttribute('aria-label', '保存した背景と部屋');

  const body = document.createElement('div');
  body.className = 'scenes__body';
  const grid = document.createElement('div');
  grid.className = 'scenes__grid';
  body.append(grid);

  // 下の帯。左に「背景」「部屋」（どちらの一覧か）、真ん中に ＋（新しく作る）、右に「家具」（家具のページを上に開く）
  const foot = createFooterBar('背景・部屋・家具');
  const tabs = (['photo', 'room'] as const).map((tabKind) =>
    createFootTab(tabKind === 'photo' ? 'image' : 'cube', tabKind === 'photo' ? '背景' : '部屋', () => {
      if (kind === tabKind) return;
      kind = tabKind;
      render();
    })
  );
  foot.left.append(...tabs);
  const createMenuSheet = createPopupMenu('新しく作る', [
    { icon: 'image', label: '新しい背景', run: () => handlers.onCreate('photo') },
    { icon: 'cube', label: '新しい部屋', run: () => handlers.onCreate('room') },
  ]);
  foot.center.append(createFootAdd('新しく作る', createMenuSheet.open));
  foot.right.append(createFootTab('chair', '家具', () => handlers.onFurniture(kind)));

  element.append(body, foot.element, createMenuSheet.element);

  function render(): void {
    tabs.forEach((tab, index) => tab.classList.toggle('is-active', (['photo', 'room'] as const)[index] === kind));
    grid.replaceChildren(...entriesOf(kind).map(createTile));
    // 無くなったもののアイコンは解放する
    const alive = new Set(sceneLibrary.get().entries.map((entry) => entry.id));
    for (const [id, url] of thumbnails) {
      if (alive.has(id)) continue;
      URL.revokeObjectURL(url);
      thumbnails.delete(id);
    }
  }

  function createTile(entry: SceneEntry): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'scene-tile';
    tile.dataset.id = entry.id;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scene-tile__button';
    button.setAttribute('aria-label', `${entry.name} を開く`);
    const image = document.createElement('span');
    image.className = 'scene-tile__img';
    applyThumbnail(entry.id, image);
    button.append(image);
    button.addEventListener('click', () => handlers.onOpen(entry));

    const name = document.createElement('span');
    name.className = 'scene-tile__name';
    name.textContent = entry.name;

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'scene-tile__more';
    more.setAttribute('aria-label', `${entry.name} のメニュー`);
    more.append(createIcon('more'));
    const menu = createMenu(
      [
        {
          icon: 'pencil',
          label: '名前を変える',
          run: async () => {
            const value = await askName(entry.name);
            if (value !== null) renameScene(entry.id, value);
          },
        },
        {
          icon: 'copy',
          label: '複製',
          run: async () => {
            const copy = await duplicateScene(entry.id);
            if (copy) handlers.onOpen(copy);
          },
        },
        {
          icon: 'trash',
          label: '削除',
          danger: true,
          run: async () => {
            if (await confirmDelete(entry.name)) await deleteScenes([entry.id]);
          },
        },
      ],
      entry.name
    );
    more.addEventListener('click', menu.open);

    tile.append(button, name, more, menu.element);
    return tile;
  }

  /** アイコンの画像を当てる。まだ読んでいなければ読んでから当てる（読む間は地の色のまま） */
  function applyThumbnail(id: string, image: HTMLElement): void {
    const known = thumbnails.get(id);
    if (known) {
      image.style.backgroundImage = `url("${known}")`;
      return;
    }
    void readSceneThumbnail(id).then((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      thumbnails.set(id, url);
      if (image.isConnected) image.style.backgroundImage = `url("${url}")`;
    });
  }

  sceneLibrary.subscribe(() => {
    if (!element.hidden) render();
  });

  return {
    element,
    open(nextKind) {
      kind = nextKind;
      // 開き直すたびにアイコンを読み直す（編集で変わっているため）
      for (const url of thumbnails.values()) URL.revokeObjectURL(url);
      thumbnails.clear();
      render();
      element.hidden = false;
    },
    close() {
      createMenuSheet.close();
      element.hidden = true;
    },
    isOpen: () => !element.hidden,
  };
}

/** 削除の確認。何を消すかを名前で出す。文言は家具の削除と同じ。消すなら true */
function confirmDelete(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    const box = document.createElement('div');
    box.className = 'modal__box';
    const title = document.createElement('p');
    title.className = 'modal__title';
    title.textContent = `「${name}」を削除します`;
    const note = document.createElement('p');
    note.className = 'hint is-error';
    note.textContent = 'この端末から完全に削除します。削除後は復元はできませんがよろしいですか？';
    const buttons = document.createElement('div');
    buttons.className = 'confirm__buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button is-quiet is-small';
    cancel.textContent = 'キャンセル';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button is-danger is-small';
    remove.textContent = '削除';
    const finish = (value: boolean): void => {
      modal.remove();
      resolve(value);
    };
    cancel.addEventListener('click', () => finish(false));
    remove.addEventListener('click', () => finish(true));
    buttons.append(cancel, remove);
    box.append(title, note, buttons);
    modal.append(box);
    document.body.append(modal);
  });
}
