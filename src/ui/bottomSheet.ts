/**
 * 画面下部のシート。家具の追加と、選択中の家具の操作を行う。
 * v4 の components/bottomsheets/（4,109 行）に相当する部分の最小版。
 *
 * UI は DOM。3D の上に重ねるだけなので three.js とは完全に切り離せる。
 *
 * **タブの並びはモードで変わる。** 写真モードには背景の選択がある。
 * 3Dモデル（置く・写真から作る）と操作は両方にある。
 */

import type { PlacedFurniture } from '@/config/furniture';
import { createModelPanel } from '@/ui/modelPanel';
import { createPhotoPanel } from '@/ui/photoPanel';
import { createRepeatButton } from '@/ui/repeatButton';
import { activeScene, isPhotoMode, modeState } from '@/core/mode';
import { appState } from '@/core/appState';
import { releaseFurnitureAssets } from '@/core/modelLibrary';
import { photoState, setMasking } from '@/core/photoState';

type TabId = 'background' | 'models' | 'manage';

const TABS: Record<TabId, string> = {
  background: '背景',
  models: '3Dモデル',
  manage: '操作',
};

/** モードごとのタブの並び */
const ROOM_TABS: TabId[] = ['models', 'manage'];
const PHOTO_TABS: TabId[] = ['background', 'models', 'manage'];

/** 1 回のボタン操作で家具を回す角度 */
const ROTATION_STEP = Math.PI / 12; // 15 度

/** 1 回のボタン操作で家具を大きくする比。掛け算なので、小さいときも大きいときも同じ手応え */
const SIZE_STEP_RATIO = 1.1;
/** 大きさの範囲（いちばん長い辺、メートル）。行き過ぎて見失わないように止める */
const SIZE_LIMITS = { min: 0.1, max: 5 };

/** 1 回のボタン操作で家具を上下させる量（メートル） */
const HEIGHT_STEP = 0.05;

export function createBottomSheet(container: HTMLElement): void {
  // 起動時のタブは、起動時のモードの最初のタブ（写真モードなら「背景」）
  let activeTab: TabId = (isPhotoMode() ? PHOTO_TABS : ROOM_TABS)[0];

  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  container.appendChild(sheet);

  const tabBar = document.createElement('div');
  tabBar.className = 'sheet__tabs';
  sheet.appendChild(tabBar);

  const body = document.createElement('div');
  body.className = 'sheet__body';
  sheet.appendChild(body);

  /** 「3Dモデル」で置いた直後の家具。これを選んだときはタブを移さない */
  let justPlacedId: string | null = null;

  // 生成は8分かかり、その間もタブを行き来できる必要がある。
  // 毎回作り直すと進行表示が途切れるので、1つ作って使い回す。
  // 置いた直後は選択状態になるが、「操作」タブへは移らない。
  // 続けて置きたいときに、置くたびにタブが変わると邪魔になる
  const modelPanel = createModelPanel({
    onPlaced: (id) => {
      justPlacedId = id;
    },
  });
  const photoPanel = createPhotoPanel();

  function visibleTabs(): TabId[] {
    return isPhotoMode() ? PHOTO_TABS : ROOM_TABS;
  }

  function render(): void {
    const tabs = visibleTabs();

    // モードを変えた直後は、前のモードにしか無いタブを開いていることがある
    if (!tabs.includes(activeTab)) activeTab = tabs[0];

    // 手前の範囲の指定は「背景」タブの中で行う。タブを離れたら指定を終え、
    // 1 本指を家具のドラッグに戻す
    if (activeTab !== 'background') setMasking(false);

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
    // 自分で状態を購読して描き替えるパネルは、作り直さず使い回す
    if (activeTab === 'models') return modelPanel;
    if (activeTab === 'background') return photoPanel;
    return renderManageTab();
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
      hint.textContent = '3Dモデルをタップすると選択できます';
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
        scene.remove(id);
        // 写真から作ったモデルの中身は、保管庫にも残っていなければここで捨てる
        releaseFurnitureAssets(selected);
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

  /** 直前に選ばれていた家具。選択が「無し → あり」に変わった瞬間を捉えるために持つ */
  let previousSelectedId: string | null = activeScene().state().selectedId;

  // 選択状態が変わったら「操作」タブの中身を描き直す必要がある。
  // どちらのモードの家具が変わったかは問わない（表示中のほうだけ描き直せばよい）。
  // 同じ家具を触っている間は行を残し、値だけ書き替える（上の manageView を参照）
  const followSelection = (): void => {
    const { selectedId, furniture } = activeScene().state();

    // タップで家具を選んだら「操作」タブへ移る。すぐ動かしたり回したりできるように。
    // 置いた直後の自動選択では移らない
    const newlySelected = selectedId !== null && selectedId !== previousSelectedId;
    // 置いた直後の家具から選択が外れたら、その後のタップは普通の選択として扱う。
    // 「置く」は add → select の 2 段階で届くので、select が来る前に忘れないよう、
    // 「選ばれていた状態から外れた」ときだけ忘れる
    const leftJustPlaced = previousSelectedId === justPlacedId && selectedId !== justPlacedId;
    previousSelectedId = selectedId;
    if (leftJustPlaced) justPlacedId = null;
    if (newlySelected && selectedId !== justPlacedId && activeTab !== 'manage') {
      activeTab = 'manage';
      render();
      return;
    }

    if (activeTab !== 'manage') return;
    const shown = manageView && furniture.find((f) => f.id === manageView?.itemId);
    if (shown && shown.id === selectedId) {
      manageView?.refresh(shown);
      return;
    }
    render();
  };
  appState.subscribe(followSelection);
  photoState.subscribe(followSelection);

  // モードが変わったら、そのモードの最初のタブへ戻す。
  // 3Dモデルタブは両方にあるので、そのままだと写真モードに入っても開いたままになり、
  // 先にやるべき「背景の写真を選ぶ」に辿り着けない
  modeState.subscribe(() => {
    activeTab = visibleTabs()[0];
    previousSelectedId = activeScene().state().selectedId;
    render();
  });

  render();
}
