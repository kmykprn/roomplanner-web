/**
 * 画面下部のシート。家具の追加と、選択中の家具の操作を行う。
 * v4 の components/bottomsheets/（4,109 行）に相当する部分の最小版。
 *
 * UI は DOM。3D の上に重ねるだけなので three.js とは完全に切り離せる。
 *
 * **タブの並びはモードで変わる。** 部屋モードには写真からの生成があり、
 * 写真モードには背景の選択がある。設置と操作は両方にある。
 */

import { FURNITURE_TYPES, type PlacedFurniture } from '@/config/furniture';
import { createGenerationPanel } from '@/ui/generationPanel';
import { createPhotoPanel } from '@/ui/photoPanel';
import { createMaskPanel } from '@/ui/maskPanel';
import { createRepeatButton } from '@/ui/repeatButton';
import { deletePreview } from '@/platform/previewCache';
import { activeScene, isPhotoMode, modeState } from '@/core/mode';
import { appState } from '@/core/appState';
import { photoState, setMasking } from '@/core/photoState';

type TabId = 'background' | 'add' | 'mask' | 'generate' | 'manage';

const TABS: Record<TabId, string> = {
  background: '背景',
  add: '設置',
  mask: '隠す',
  generate: '写真から',
  manage: '操作',
};

/** モードごとのタブの並び */
const ROOM_TABS: TabId[] = ['add', 'generate', 'manage'];
const PHOTO_TABS: TabId[] = ['background', 'add', 'mask', 'manage'];

/** 1 回のボタン操作で家具を回す角度 */
const ROTATION_STEP = Math.PI / 12; // 15 度

/** 1 回のボタン操作で家具を大きくする比。掛け算なので、小さいときも大きいときも同じ手応え */
const SIZE_STEP_RATIO = 1.1;
/** 大きさの範囲（いちばん長い辺、メートル）。行き過ぎて見失わないように止める */
const SIZE_LIMITS = { min: 0.1, max: 5 };

/** 1 回のボタン操作で家具を上下させる量（メートル） */
const HEIGHT_STEP = 0.05;

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
  const maskPanel = createMaskPanel();

  function visibleTabs(): TabId[] {
    return isPhotoMode() ? PHOTO_TABS : ROOM_TABS;
  }

  function render(): void {
    const tabs = visibleTabs();

    // モードを変えた直後は、前のモードにしか無いタブを開いていることがある
    if (!tabs.includes(activeTab)) activeTab = tabs[0];

    // 「隠す」タブを開いている間だけ 1 本指が筆になる。
    // 閉じたら家具のドラッグに戻す
    setMasking(activeTab === 'mask');

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
    if (activeTab === 'mask') return maskPanel;
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

  /**
   * いま出している「操作」タブの行。
   *
   * **状態が変わるたびに作り直さない。** 押しっぱなしのボタンが指の下で
   * 作り替えられると、離す合図がボタンに届かず動き続ける。同じ家具を触っている
   * 間は値だけを書き替え、別の家具を選んだときだけ作り直す
   */
  let manageView: { itemId: string; refresh(item: PlacedFurniture): void } | null = null;

  /** 選択中の家具に対する操作 */
  function renderManageTab(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'manage';
    manageView = null;

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

    const { id } = selected;
    const rows = [
      createManageRow('向き', [
        ['⟲', '左に回す', () => rotate(id, -ROTATION_STEP)],
        ['⟳', '右に回す', () => rotate(id, ROTATION_STEP)],
      ], (item) => formatAngle(item.rotationY)),
      createManageRow('大きさ', [
        ['−', '小さくする', () => resize(id, 1 / SIZE_STEP_RATIO)],
        ['＋', '大きくする', () => resize(id, SIZE_STEP_RATIO)],
      ], (item) => `幅 ${item.size[0].toFixed(2)} m`),
      createManageRow('高さ', [
        ['↓', '下げる', () => lift(id, -HEIGHT_STEP)],
        ['↑', '上げる', () => lift(id, HEIGHT_STEP)],
      ], (item) => formatHeight(item.position[1])),
    ];

    wrapper.append(
      ...rows.map((row) => row.element),
      createButton('削除', () => {
        if (selected.sourceImageKey) void deletePreview(selected.sourceImageKey);
        scene.remove(id);
      }, 'is-danger manage__delete')
    );

    manageView = {
      itemId: id,
      refresh: (item) => rows.forEach((row) => row.refresh(item)),
    };
    manageView.refresh(selected);
    return wrapper;
  }

  /**
   * 「見出し・減らす・増やす・いまの値」の1行。
   * ボタンは押しっぱなしで動き続ける。値は refresh で書き替える
   */
  function createManageRow(
    label: string,
    buttons: Array<[mark: string, description: string, act: () => void]>,
    format: (item: PlacedFurniture) => string
  ): { element: HTMLElement; refresh(item: PlacedFurniture): void } {
    const element = document.createElement('div');
    element.className = 'manage__row';

    const heading = document.createElement('span');
    heading.className = 'manage__label';
    heading.textContent = label;

    const value = document.createElement('span');
    value.className = 'manage__value';

    element.append(
      heading,
      ...buttons.map(([mark, description, act]) =>
        createRepeatButton(mark, `${label}を${description}`, act)
      ),
      value
    );
    return {
      element,
      refresh: (item) => {
        value.textContent = format(item);
      },
    };
  }

  /**
   * 家具の大きさを変える。3辺そろえて掛けるので形は変わらない。
   *
   * 部屋モードでは大きくした結果が壁を突き抜けることがあるので、位置を丸め直す
   */
  function resize(id: string, ratio: number): void {
    const scene = activeScene();
    const item = scene.state().furniture.find((f) => f.id === id);
    if (!item) return;

    const longest = Math.max(...item.size);
    if (longest * ratio < SIZE_LIMITS.min || longest * ratio > SIZE_LIMITS.max) return;

    const size = item.size.map((edge) => edge * ratio) as [number, number, number];
    scene.update(id, {
      size,
      position: scene.constrain(item.position, size, item.rotationY),
    });
  }

  /** 家具を上下に動かす。下限はモードが決める（部屋なら床、写真なら無し） */
  function lift(id: string, step: number): void {
    const scene = activeScene();
    const item = scene.state().furniture.find((f) => f.id === id);
    if (!item) return;

    const [x, y, z] = item.position;
    scene.update(id, {
      position: scene.constrain([x, y + step, z], item.size, item.rotationY),
    });
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

  /** 向き。何周も回したときに数字が読めなくならないよう 0〜359 に畳む */
  function formatAngle(radians: number): string {
    const degrees = Math.round((radians * 180) / Math.PI);
    return `${((degrees % 360) + 360) % 360}°`;
  }

  /** 床からの高さ。写真モードでは床より下にも行けるので、符号を付けて出す */
  function formatHeight(y: number): string {
    const rounded = Math.round(y * 100) / 100;
    const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
    return `${sign}${Math.abs(rounded).toFixed(2)} m`;
  }

  function createButton(label: string, onClick: () => void, modifier = ''): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = `button ${modifier}`.trim();
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  // 選択状態が変わったら「操作」タブの中身を描き直す必要がある。
  // どちらのモードの家具が変わったかは問わない（表示中のほうだけ描き直せばよい）。
  // 同じ家具を触っている間は行を残し、値だけ書き替える（上の manageView を参照）
  const redrawManageTab = (): void => {
    if (activeTab !== 'manage') return;
    const { selectedId, furniture } = activeScene().state();
    const shown = manageView && furniture.find((f) => f.id === manageView?.itemId);
    if (shown && shown.id === selectedId) {
      manageView?.refresh(shown);
      return;
    }
    render();
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
