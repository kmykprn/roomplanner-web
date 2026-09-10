/**
 * 画面下部のシート。家具の追加と、選択中の家具の操作を行う。
 * v4 の components/bottomsheets/（4,109 行）に相当する部分の最小版。
 *
 * UI は DOM。3D の上に重ねるだけなので three.js とは完全に切り離せる。
 */

import { FURNITURE_TYPES } from '@/config/furniture';
import { createGenerationPanel } from '@/ui/generationPanel';
import { deletePreview, resolvePreview } from '@/platform/previewCache';
import {
  appState,
  addFurniture,
  removeFurniture,
  updateFurniture,
  selectFurniture,
  findFreePosition,
  clampInsideRoom,
} from '@/core/appState';

type TabId = 'add' | 'generate' | 'manage';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'add', label: '設置' },
  { id: 'generate', label: '写真から' },
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

  // 生成は8分かかり、その間もタブを行き来できる必要がある。
  // 毎回作り直すと進行表示が途切れるので、1つ作って使い回す
  const generationPanel = createGenerationPanel();

  function render(): void {
    // タブの選択状態を反映する
    [...tabBar.children].forEach((child, index) => {
      child.classList.toggle('is-active', TABS[index].id === activeTab);
    });

    body.replaceChildren(renderActiveTab());
  }

  function renderActiveTab(): HTMLElement {
    if (activeTab === 'add') return renderAddTab();
    // 生成パネルは自分で状態を購読して描き替えるので、作り直さず使い回す
    if (activeTab === 'generate') return generationPanel;
    return renderManageTab();
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

    if (selected.sourceImageName) {
      const source = document.createElement('div');
      source.className = 'source-preview';
      const image = document.createElement('img');
      image.className = 'source-preview__image';
      image.alt = `${selected.sourceImageName} のプレビュー`;
      const name = document.createElement('span');
      name.textContent = selected.sourceImageName;
      source.append(image, name);
      if (selected.sourceImageKey) {
        void resolvePreview(selected.sourceImageKey).then((url) => {
          if (url) image.src = url;
        });
      }
      wrapper.append(source);
    }

    wrapper.append(
      createButton('⟲ 左に回す', () => rotate(selected.id, -ROTATION_STEP)),
      createButton('⟳ 右に回す', () => rotate(selected.id, ROTATION_STEP)),
      createButton('削除', () => {
        if (selected.sourceImageKey) void deletePreview(selected.sourceImageKey);
        removeFurniture(selected.id);
      }, 'is-danger')
    );

    return wrapper;
  }

  /**
   * 家具を回す。
   *
   * 回すと上から見た輪郭が広がるため、壁ぎわの家具はそのままだと壁を突き抜ける。
   * 回転後の向きで位置を計算し直し、部屋の中へ押し戻す。
   */
  function rotate(id: string, step: number): void {
    const { furniture, room } = appState.get();
    const item = furniture.find((f) => f.id === id);
    if (!item) return;

    const rotationY = item.rotationY + step;
    updateFurniture(id, {
      rotationY,
      position: clampInsideRoom(item.position, item.size, rotationY, room),
    });
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
