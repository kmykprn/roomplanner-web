/**
 * 画面下部のシート。家具の追加と、選択中の家具の操作を行う。
 * v4 の components/bottomsheets/（4,109 行）に相当する部分の最小版。
 *
 * UI は DOM。3D の上に重ねるだけなので three.js とは完全に切り離せる。
 */

import { FURNITURE_TYPES } from '@/config/furniture';
import {
  appState,
  addFurniture,
  removeFurniture,
  updateFurniture,
  selectFurniture,
  findFreePosition,
} from '@/core/appState';

type TabId = 'add' | 'manage';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'add', label: '設置' },
  { id: 'manage', label: '操作' },
];

/** 1 回のボタン操作で家具を回す角度 */
const ROTATION_STEP = Math.PI / 12; // 15 度

export function createBottomSheet(container: HTMLElement): void {
  let activeTab: TabId = 'add';

  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  container.appendChild(sheet);

  const tabBar = document.createElement('div');
  tabBar.className = 'sheet__tabs';
  sheet.appendChild(tabBar);

  const body = document.createElement('div');
  body.className = 'sheet__body';
  sheet.appendChild(body);

  for (const tab of TABS) {
    const button = document.createElement('button');
    button.className = 'sheet__tab';
    button.textContent = tab.label;
    button.addEventListener('click', () => {
      activeTab = tab.id;
      render();
    });
    tabBar.appendChild(button);
  }

  function render(): void {
    // タブの選択状態を反映する
    [...tabBar.children].forEach((child, index) => {
      child.classList.toggle('is-active', TABS[index].id === activeTab);
    });

    body.replaceChildren(activeTab === 'add' ? renderAddTab() : renderManageTab());
  }

  /** 家具の一覧。押すと部屋の中央に置く */
  function renderAddTab(): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'grid';

    for (const type of FURNITURE_TYPES) {
      const button = document.createElement('button');
      button.className = 'chip';

      const swatch = document.createElement('span');
      swatch.className = 'chip__swatch';
      swatch.style.background = type.color;
      button.append(swatch, type.name);

      button.addEventListener('click', () => {
        const id = crypto.randomUUID();
        addFurniture({
          id,
          typeId: type.id,
          // 底面基準なので y = 0 が床置き。既存の家具に埋まらない場所を選ぶ
          position: findFreePosition(type.defaultSize),
          rotationY: 0,
          size: [...type.defaultSize],
          color: type.color,
        });
        selectFurniture(id);
      });

      grid.appendChild(button);
    }

    return grid;
  }

  /** 選択中の家具に対する操作 */
  function renderManageTab(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'row';

    const { selectedId, furniture } = appState.get();
    const selected = furniture.find((f) => f.id === selectedId);

    if (!selected) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = '家具をタップすると選択できます';
      wrapper.appendChild(hint);
      return wrapper;
    }

    wrapper.append(
      createButton('⟲ 左に回す', () => {
        updateFurniture(selected.id, { rotationY: selected.rotationY - ROTATION_STEP });
      }),
      createButton('⟳ 右に回す', () => {
        updateFurniture(selected.id, { rotationY: selected.rotationY + ROTATION_STEP });
      }),
      createButton('削除', () => removeFurniture(selected.id), 'is-danger')
    );

    return wrapper;
  }

  function createButton(label: string, onClick: () => void, modifier = ''): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = `button ${modifier}`.trim();
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  // 選択状態が変わったら「操作」タブの中身を描き直す必要がある
  appState.subscribe(() => {
    if (activeTab === 'manage') render();
  });

  render();
}
