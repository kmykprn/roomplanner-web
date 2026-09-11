/**
 * 画面下部のシート。家具の追加と、選択中の家具の操作を行う。
 * v4 の components/bottomsheets/（4,109 行）に相当する部分の最小版。
 *
 * UI は DOM。3D の上に重ねるだけなので three.js とは完全に切り離せる。
 *
 * **タブの並びはモードで変わる。** 部屋モードには写真からの生成があり、
 * 写真モードには背景の選択がある。設置と操作は両方にある。
 */

import { FURNITURE_TYPES } from '@/config/furniture';
import { createGenerationPanel } from '@/ui/generationPanel';
import { createPhotoPanel } from '@/ui/photoPanel';
import { deletePreview } from '@/platform/previewCache';
import { activeScene, isPhotoMode, modeState } from '@/core/mode';
import { appState } from '@/core/appState';
import { photoState } from '@/core/photoState';

type TabId = 'background' | 'add' | 'generate' | 'manage';

const TABS: Record<TabId, string> = {
  background: '背景',
  add: '設置',
  generate: '写真から',
  manage: '操作',
};

/** モードごとのタブの並び */
const ROOM_TABS: TabId[] = ['add', 'generate', 'manage'];
const PHOTO_TABS: TabId[] = ['background', 'add', 'manage'];

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

  // 生成は8分かかり、その間もタブを行き来できる必要がある。
  // 毎回作り直すと進行表示が途切れるので、1つ作って使い回す
  const generationPanel = createGenerationPanel();
  const photoPanel = createPhotoPanel();

  function visibleTabs(): TabId[] {
    return isPhotoMode() ? PHOTO_TABS : ROOM_TABS;
  }

  function render(): void {
    const tabs = visibleTabs();

    // モードを変えた直後は、前のモードにしか無いタブを開いていることがある
    if (!tabs.includes(activeTab)) activeTab = tabs[0];

    tabBar.replaceChildren(
      ...tabs.map((tab) => {
        const button = document.createElement('button');
        button.className = 'sheet__tab';
        button.classList.toggle('is-active', tab === activeTab);
        button.textContent = TABS[tab];
        button.addEventListener('click', () => {
          activeTab = tab;
          render();
        });
        return button;
      })
    );

    body.replaceChildren(renderActiveTab());
  }

  function renderActiveTab(): HTMLElement {
    if (activeTab === 'add') return renderAddTab();
    // 自分で状態を購読して描き替えるパネルは、作り直さず使い回す
    if (activeTab === 'generate') return generationPanel;
    if (activeTab === 'background') return photoPanel;
    return renderManageTab();
  }

  /** 家具の一覧。押すと空いている場所に置く */
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
        const scene = activeScene();
        const id = crypto.randomUUID();
        scene.add({
          id,
          typeId: type.id,
          // 底面基準なので y = 0 が床置き。既存の家具に埋まらない場所を選ぶ
          position: scene.placementFor(type.defaultSize),
          rotationY: 0,
          size: [...type.defaultSize],
          color: type.color,
        });
        scene.select(id);
      });

      grid.appendChild(button);
    }

    return grid;
  }

  /** 選択中の家具に対する操作 */
  function renderManageTab(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'row';

    const scene = activeScene();
    const { selectedId, furniture } = scene.state();
    const selected = furniture.find((f) => f.id === selectedId);

    if (!selected) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = '家具をタップすると選択できます';
      wrapper.appendChild(hint);
      return wrapper;
    }

    wrapper.append(
      createButton('⟲ 左に回す', () => rotate(selected.id, -ROTATION_STEP)),
      createButton('⟳ 右に回す', () => rotate(selected.id, ROTATION_STEP)),
      createButton('削除', () => {
        if (selected.sourceImageKey) void deletePreview(selected.sourceImageKey);
        scene.remove(selected.id);
      }, 'is-danger')
    );

    return wrapper;
  }

  /**
   * 家具を回す。
   *
   * 回すと上から見た輪郭が広がるため、壁ぎわの家具はそのままだと壁を突き抜ける。
   * 回転後の向きで位置を計算し直し、置ける範囲へ押し戻す
   * （写真モードには壁が無いので、そのモードでは何も動かない）。
   */
  function rotate(id: string, step: number): void {
    const scene = activeScene();
    const item = scene.state().furniture.find((f) => f.id === id);
    if (!item) return;

    const rotationY = item.rotationY + step;
    scene.update(id, {
      rotationY,
      position: scene.constrain(item.position, item.size, rotationY),
    });
  }

  function createButton(label: string, onClick: () => void, modifier = ''): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = `button ${modifier}`.trim();
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  // 選択状態が変わったら「操作」タブの中身を描き直す必要がある。
  // どちらのモードの家具が変わったかは問わない（表示中のほうだけ描き直せばよい）
  const redrawManageTab = (): void => {
    if (activeTab === 'manage') render();
  };
  appState.subscribe(redrawManageTab);
  photoState.subscribe(redrawManageTab);

  // モードが変わったら、そのモードの最初のタブへ戻す。
  // 設置タブは両方にあるので、そのままだと写真モードに入っても設置が開いたままになり、
  // 先にやるべき「背景の写真を選ぶ」に辿り着けない
  modeState.subscribe(() => {
    activeTab = visibleTabs()[0];
    render();
  });

  render();
}
