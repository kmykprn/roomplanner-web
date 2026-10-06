/**
 * 保存した背景と部屋の一覧。アプリを開いたときの最初の画面（背景が 1 つも無いときだけは、新しい背景の編集から）。
 *
 *   下のタブ       … 背景の一覧か、部屋の一覧か。1 つも無い種類は、空の一覧を見せずに新しく作って編集へ
 *   ＋             … 背景なら写真を選んですぐ編集へ、部屋なら新しい部屋を作って編集へ
 *   タイル         … 押すとそれを開いて編集の画面へ。アイコンは保存したときの画面の縮小、下は名前だけ
 *   タイルの ⋯     … 名前を変える・複製（複製したものを開く）
 *   選択して削除   … タイルに ✓ を付けて「削除」。件数は出さない。確認は家具の削除と同じ文言
 *
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
import { createIcon } from '@/ui/icons';
import { askName } from '@/ui/nameDialog';
import { createMenu } from '@/ui/photoMenu';

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
}

const LABELS: Record<SceneKind, { title: string; add: string }> = {
  photo: { title: '背景', add: '背景の画像を選ぶ' },
  room: { title: '部屋', add: '部屋を作る' },
};

export function createScenePage(handlers: ScenePageHandlers): ScenePage {
  let kind: SceneKind = 'photo';
  /** 選んで消している最中か */
  let selecting = false;
  const picked = new Set<string>();
  /** アイコンの画像の URL。読んだら覚えておき、消えたものは解放する */
  const thumbnails = new Map<string, string>();

  const element = document.createElement('div');
  element.className = 'scenes';
  element.hidden = true;
  element.setAttribute('aria-label', '保存した背景と部屋');

  const bar = document.createElement('div');
  bar.className = 'scenes__bar';
  const title = document.createElement('span');
  title.className = 'scenes__title';
  bar.append(document.createElement('span'), title, document.createElement('span'));

  const body = document.createElement('div');
  body.className = 'scenes__body';
  const tools = document.createElement('div');
  tools.className = 'scenes__tools';
  const selectButton = document.createElement('button');
  selectButton.type = 'button';
  selectButton.className = 'manage__select';
  selectButton.addEventListener('click', () => setSelecting(!selecting));
  tools.append(selectButton);
  const grid = document.createElement('div');
  grid.className = 'scenes__grid';
  body.append(tools, grid);

  // 選んで消している間だけ出す「削除」
  const actions = document.createElement('div');
  actions.className = 'scenes__actions';
  actions.hidden = true;
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'button is-danger is-small';
  removeButton.textContent = '削除';
  removeButton.addEventListener('click', () => void confirmRemove());
  actions.append(removeButton);

  const tabs = document.createElement('nav');
  tabs.className = 'scenes__tabs';
  tabs.setAttribute('aria-label', '背景と部屋');
  const tabButtons = (['photo', 'room'] as const).map((tabKind) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scenes__tab';
    button.append(createIcon(tabKind === 'photo' ? 'image' : 'cube'), Object.assign(document.createElement('span'), { textContent: LABELS[tabKind].title }));
    button.addEventListener('click', () => {
      // 1 つも無い種類は、空の一覧を見せずに新しく作って編集へ
      if (entriesOf(tabKind).length === 0) {
        handlers.onCreate(tabKind);
        return;
      }
      if (kind === tabKind) return;
      kind = tabKind;
      setSelecting(false);
      render();
    });
    tabs.append(button);
    return button;
  });

  element.append(bar, body, actions, tabs);

  function setSelecting(value: boolean): void {
    selecting = value;
    picked.clear();
    render();
  }

  /** 「削除」。家具の削除と同じ確認を出してから消す */
  async function confirmRemove(): Promise<void> {
    if (picked.size === 0) return;
    const ok = await confirmDelete(picked.size);
    if (!ok) return;
    await deleteScenes([...picked]);
    setSelecting(false);
  }

  function render(): void {
    const labels = LABELS[kind];
    title.textContent = labels.title;
    tabButtons.forEach((button, index) => button.classList.toggle('is-active', (['photo', 'room'] as const)[index] === kind));
    element.classList.toggle('is-selecting', selecting);
    selectButton.replaceChildren();
    if (selecting) {
      selectButton.textContent = 'キャンセル';
    } else {
      selectButton.append(createIcon('checkbox'), Object.assign(document.createElement('span'), { textContent: '選択して削除' }));
    }
    actions.hidden = !selecting;
    removeButton.disabled = picked.size === 0;

    const entries = entriesOf(kind);
    const nodes: HTMLElement[] = [createAddTile(labels.add)];
    for (const entry of entries) nodes.push(createTile(entry));
    grid.replaceChildren(...nodes);
    // 無くなったもののアイコンは解放する
    const alive = new Set(sceneLibrary.get().entries.map((entry) => entry.id));
    for (const [id, url] of thumbnails) {
      if (alive.has(id)) continue;
      URL.revokeObjectURL(url);
      thumbnails.delete(id);
    }
  }

  function createAddTile(label: string): HTMLElement {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'scene-tile scene-tile--add';
    tile.disabled = selecting;
    tile.append(createIcon('plus'), Object.assign(document.createElement('span'), { textContent: label }));
    tile.addEventListener('click', () => handlers.onCreate(kind));
    return tile;
  }

  function createTile(entry: SceneEntry): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'scene-tile';
    tile.dataset.id = entry.id;
    tile.classList.toggle('is-picked', picked.has(entry.id));

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scene-tile__button';
    button.setAttribute('aria-label', selecting ? `${entry.name} を選ぶ` : `${entry.name} を開く`);
    const image = document.createElement('span');
    image.className = 'scene-tile__img';
    applyThumbnail(entry.id, image);
    button.append(image);
    if (selecting) {
      const pick = document.createElement('span');
      pick.className = 'thumb__pick';
      pick.append(createIcon('check'));
      button.append(pick);
    }
    button.addEventListener('click', () => {
      if (!selecting) {
        handlers.onOpen(entry);
        return;
      }
      if (picked.has(entry.id)) picked.delete(entry.id);
      else picked.add(entry.id);
      render();
    });

    const name = document.createElement('span');
    name.className = 'scene-tile__name';
    name.textContent = entry.name;
    tile.append(button, name);

    if (!selecting) {
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
        ],
        entry.name
      );
      more.addEventListener('click', menu.open);
      tile.append(more, menu.element);
    }
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
      selecting = false;
      picked.clear();
      // 開き直すたびにアイコンを読み直す（編集で変わっているため）
      for (const url of thumbnails.values()) URL.revokeObjectURL(url);
      thumbnails.clear();
      render();
      element.hidden = false;
    },
    close() {
      element.hidden = true;
    },
    isOpen: () => !element.hidden,
  };
}

/** 削除の確認。家具の削除と同じ文言。消すなら true */
function confirmDelete(count: number): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    const box = document.createElement('div');
    box.className = 'modal__box';
    const title = document.createElement('p');
    title.className = 'modal__title';
    title.textContent = count === 1 ? '選んだものを削除します' : '選んだものをまとめて削除します';
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
