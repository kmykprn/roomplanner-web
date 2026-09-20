/**
 * 画面下部のシート。家具の追加と、選択中の家具の操作を行う。
 * v4 の components/bottomsheets/（4,109 行）に相当する部分の最小版。
 *
 * UI は DOM。3D の上に重ねるだけなので three.js とは完全に切り離せる。
 *
 * **タブの並びはモードで変わる。** 写真モードには背景の選択がある。
 * 家具（置く・写真から作る）と操作は両方にある。
 */

import type { PlacedFurniture } from '@/config/furniture';
import { createModelPanel } from '@/ui/modelPanel';
import { createPreviewImage } from '@/ui/previewImage';
import { createProductLink } from '@/ui/productLink';
import { createPhotoPanel } from '@/ui/photoPanel';
import { createInteriorPanel } from '@/ui/interiorPanel';
import { createIcon, type IconName } from '@/ui/icons';
import { createRepeatButton } from '@/ui/repeatButton';
import { activeScene, isPhotoMode, modeState } from '@/core/mode';
import { appState } from '@/core/appState';
import { releaseFurnitureAssets } from '@/core/modelLibrary';
import { photoState, setMasking } from '@/core/photoState';

type TabId = 'interior' | 'background' | 'models' | 'manage';

/** 「操作」の行に敷くバーの決まりごと。値の単位は行ごとに違う（向きなら度） */
interface ManageSlider {
  /** 読み上げ用の名前。画面には出さない（見出しは行の左にある） */
  label: string;
  min: number;
  max: number;
  /** バーの両端に添える文字。動かせる幅が見て分かるように */
  ends: [from: string, to: string];
  valueOf(item: PlacedFurniture): number;
  onInput(value: number): void;
}

const TABS: Record<TabId, string> = {
  interior: '内装',
  background: '背景',
  models: '家具',
  manage: '操作',
};

/** モードごとのタブの並び。部屋は内装（壁と床）、写真は背景（部屋の写真）から始まる */
const ROOM_TABS: TabId[] = ['interior', 'models', 'manage'];
const PHOTO_TABS: TabId[] = ['background', 'models', 'manage'];

/** 1 回のボタン操作で家具を回す角度 */
const ROTATION_STEP = Math.PI / 12; // 15 度

/** 1 回のボタン操作で家具を大きくする比。掛け算なので、小さいときも大きいときも同じ手応え */
const SIZE_STEP_RATIO = 1.1;
/** 大きさの範囲（いちばん長い辺、メートル）。行き過ぎて見失わないように止める */
const SIZE_LIMITS = { min: 0.1, max: 5 };

/** 1 回のボタン操作で家具を上下させる量（メートル） */
const HEIGHT_STEP = 0.05;

/** 1 回のボタン操作で傾ける角度（板の回転と、3D の前後の傾き） */
const TILT_STEP = Math.PI / 36; // 5 度

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

  /** 「家具」で置いた直後の家具。これを選んだときはタブを移さない */
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
  const interiorPanel = createInteriorPanel();

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
    if (activeTab === 'interior') return interiorPanel;
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
      wrapper.append(createFurnitureList(furniture));
      return wrapper;
    }

    const { id } = selected;
    const rows: ReturnType<typeof createManageRow>[] = [];
    // 切り抜きの板はカメラの方を向くので「向き」は効かない。板は画面の中で回す「傾き」だけ
    if (!isBillboard(selected)) {
      rows.push(
        createManageRow('向き', [
          ['rotateLeft', '左に回す', () => rotate(id, -ROTATION_STEP)],
          ['rotateRight', '右に回す', () => rotate(id, ROTATION_STEP)],
        ], (item) => formatAngle(item.rotationY), {
          // ボタンは 15° ずつ。ちょうど 90° のようなキリのいい向きに合わせるのはボタンが速い。
          // バーは 1° ずつで、その間の向きに合わせたいときと、一気に回したいときのためのもの
          label: '向きをバーで変える',
          min: 0,
          max: 359,
          ends: ['0°', '360°'],
          valueOf: (item) => degreesOf(item.rotationY),
          onInput: (degrees) => setRotation(id, (degrees * Math.PI) / 180),
        })
      );
    }
    rows.push(
      createManageRow('大きさ', [
        ['shrink', '小さくする', () => resize(id, 1 / SIZE_STEP_RATIO)],
        ['grow', '大きくする', () => resize(id, SIZE_STEP_RATIO)],
      ], (item) => `幅 ${item.size[0].toFixed(2)} m`),
      createManageRow('高さ', [
        ['down', '下げる', () => lift(id, -HEIGHT_STEP)],
        ['up', '上げる', () => lift(id, HEIGHT_STEP)],
      ], (item) => formatHeight(item.position[1]))
    );
    if (isBillboard(selected)) {
      rows.push(
        createManageRow('傾き', [
          ['rotateLeft', '左に傾ける', () => tilt(id, TILT_STEP)],
          ['rotateRight', '右に傾ける', () => tilt(id, -TILT_STEP)],
        ], (item) => formatTilt(item.tilt ?? 0))
      );
    } else {
      // 3D は前後に倒す（寄りかかった椅子、傾いた看板など）
      rows.push(
        createManageRow('傾き', [
          ['down', '前に傾ける', () => pitch(id, -TILT_STEP)],
          ['up', '後ろに傾ける', () => pitch(id, TILT_STEP)],
        ], (item) => formatTilt(item.pitch ?? 0))
      );
    }

    // 削除は右下に寄せる（誤タップを避ける）。
    // **消えるのは置いた分だけで、いつでも置き直せる。** 家具そのものを消す赤いボタンと
    // 同じ見た目にすると同じ重さに見えるので、グレーにして下に残ることを添える
    const foot = document.createElement('div');
    foot.className = 'manage__foot';
    // 商品ページから取り込んだ家具なら、ここから買いに行ける（削除の左に置く）
    if (selected.product) foot.append(createProductLink(selected.product));
    const remove = createButton('画面から削除', () => {
      scene.remove(id);
      // 写真から作った家具の中身は、保管庫にも残っていなければここで捨てる
      releaseFurnitureAssets(selected);
    }, 'is-small manage__delete');
    foot.append(remove);

    const footNote = document.createElement('p');
    footNote.className = 'hint manage__note';
    footNote.textContent = '画面から削除しても、「家具」タブには残ります';

    wrapper.append(...rows.map((row) => row.element), foot, footNote);

    manageView = {
      itemId: id,
      refresh: (item) => rows.forEach((row) => row.refresh(item)),
    };
    manageView.refresh(selected);
    return wrapper;
  }

  /**
   * 「見出し」と「減らす｜いまの値｜増やす」の 1 行。バーを足すと 2 段になる。
   *
   * 値をボタンの間に挟むのは、どのボタンがどの値に効くかを目で往復させないため。
   * ボタンは押しっぱなしで動き続ける。値は refresh で書き替える。
   *
   * **バーはボタンの代わりではなく、並べて置く。** ボタンは決まった刻みなので
   * 「ちょうど 90°」に合わせるのが速く、バーはその間の値と、一気に動かすのが速い
   */
  function createManageRow(
    label: string,
    buttons: [
      decrease: [icon: IconName, description: string, act: () => void],
      increase: [icon: IconName, description: string, act: () => void],
    ],
    format: (item: PlacedFurniture) => string,
    slider?: ManageSlider
  ): { element: HTMLElement; refresh(item: PlacedFurniture): void } {
    const element = document.createElement('div');
    element.className = 'manage__row';

    const heading = document.createElement('span');
    heading.className = 'manage__label';
    heading.textContent = label;

    const value = document.createElement('span');
    value.className = 'manage__value';

    const control = document.createElement('span');
    control.className = 'manage__control';
    const [decrease, increase] = buttons;
    const button = ([icon, description, act]: (typeof buttons)[number]): HTMLButtonElement =>
      createRepeatButton(createIcon(icon), description, act, 'manage__button');
    control.append(button(decrease), value, button(increase));

    element.append(heading, control);

    const bar = slider ? createManageSlider(slider) : null;
    if (bar) element.append(bar.element);

    return {
      element,
      refresh: (item) => {
        value.textContent = format(item);
        bar?.refresh(item);
      },
    };
  }

  /**
   * 行の下段に敷くバー。両端に動かせる幅を数字で添える。
   *
   * **つまみを動かしている間は書き戻さない。** 状態が変わるたびに refresh が来るので、
   * 書き戻すと、丸めの差でつまみが指の下から逃げることがある
   */
  function createManageSlider(
    slider: ManageSlider
  ): { element: HTMLElement; refresh(item: PlacedFurniture): void } {
    const element = document.createElement('div');
    element.className = 'manage__slider';

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'manage__range';
    input.min = String(slider.min);
    input.max = String(slider.max);
    input.step = '1';
    input.setAttribute('aria-label', slider.label);

    let holding = false;
    input.addEventListener('pointerdown', () => {
      holding = true;
    });
    input.addEventListener('input', () => slider.onInput(Number(input.value)));
    for (const type of ['pointerup', 'pointercancel', 'blur'] as const) {
      input.addEventListener(type, () => {
        holding = false;
      });
    }

    const [from, to] = slider.ends;
    element.append(createEndLabel(from), input, createEndLabel(to));
    return {
      element,
      refresh: (item) => {
        if (!holding) input.value = String(slider.valueOf(item));
      },
    };
  }

  function createEndLabel(text: string): HTMLElement {
    const element = document.createElement('span');
    element.className = 'manage__end';
    element.textContent = text;
    return element;
  }

  /**
   * 置いてある家具の一覧。何も選んでいないときに出す。
   *
   * 画面の外に出てしまった家具や、大きくしすぎて掴めない家具は、画面をタップしても
   * 選べない。一覧からなら選べるし、消せる。行を押すと選択になり、操作の行に切り替わる
   */
  function createFurnitureList(furniture: PlacedFurniture[]): HTMLElement {
    const list = document.createElement('div');
    list.className = 'manage__list';
    if (furniture.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = '「家具」タブで置いた家具が、ここに並びます';
      list.append(hint);
      return list;
    }
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = '家具をタップすると選択できます。画面の外にある家具は、この一覧から選べます';
    list.append(hint);

    const scene = activeScene();
    for (const item of furniture) {
      const row = document.createElement('div');
      row.className = 'manage__item';

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'manage__pick';
      const icon = document.createElement('span');
      icon.className = 'manage__icon';
      if (item.sourceImageKey) {
        createPreviewImage(icon).show(item.sourceImageKey);
      } else {
        icon.style.background = item.color;
      }
      const name = document.createElement('span');
      name.className = 'manage__name';
      name.textContent = item.name ?? item.typeId;
      pick.append(icon, name);
      pick.addEventListener('click', () => scene.select(item.id));

      const remove = createButton('', () => {
        scene.remove(item.id);
        releaseFurnitureAssets(item);
      }, 'is-small manage__delete');
      remove.setAttribute('aria-label', `${name.textContent} を画面から削除`);
      remove.append(createIcon('trash'));

      row.append(pick, remove);
      list.append(row);
    }
    return list;
  }

  /** 切り抜きの板か（3D を持たず、切り抜きだけを持つ家具） */
  function isBillboard(item: PlacedFurniture): boolean {
    return Boolean(item.imageUrl) && !item.modelUrl;
  }

  /** 3D を前後に倒す。上限は無し（横倒しにしたい人もいる） */
  function pitch(id: string, step: number): void {
    const scene = activeScene();
    const item = scene.state().furniture.find((f) => f.id === id);
    if (!item) return;
    scene.update(id, { pitch: (item.pitch ?? 0) + step });
  }

  /** 切り抜きの板を画面の中で回す。上限は無し（逆さまにしたい人もいる） */
  function tilt(id: string, step: number): void {
    const scene = activeScene();
    const item = scene.state().furniture.find((f) => f.id === id);
    if (!item) return;
    scene.update(id, { tilt: (item.tilt ?? 0) + step });
  }

  /** 傾き。左が正。0 は「0°」、それ以外は符号付きで出す */
  function formatTilt(radians: number): string {
    const degrees = Math.round((radians * 180) / Math.PI);
    const sign = degrees > 0 ? '+' : degrees < 0 ? '−' : '';
    return `${sign}${Math.abs(degrees)}°`;
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
    const item = activeScene().state().furniture.find((f) => f.id === id);
    if (!item) return;
    setRotation(id, item.rotationY + step);
  }

  /** 向きをその角度に決める（バーから呼ばれる）。壁への押し戻しは rotate と同じ */
  function setRotation(id: string, rotationY: number): void {
    const scene = activeScene();
    const item = scene.state().furniture.find((f) => f.id === id);
    if (!item) return;
    scene.update(id, {
      rotationY,
      position: scene.constrain(item.position, item.size, rotationY),
    });
  }

  /** 向き。何周も回したときに数字が読めなくならないよう 0〜359 に畳む */
  function formatAngle(radians: number): string {
    return `${degreesOf(radians)}°`;
  }

  /** 向きを 0〜359 の度数にする。表示にもバーの位置にも同じ値を使う */
  function degreesOf(radians: number): number {
    const degrees = Math.round((radians * 180) / Math.PI);
    return ((degrees % 360) + 360) % 360;
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
  // 家具タブは両方にあるので、そのままだと写真モードに入っても開いたままになり、
  // 先にやるべき「背景の写真を選ぶ」に辿り着けない
  modeState.subscribe(() => {
    activeTab = visibleTabs()[0];
    previousSelectedId = activeScene().state().selectedId;
    render();
  });

  render();
}
