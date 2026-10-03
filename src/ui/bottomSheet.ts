/**
 * 画面下部のシート。家具の追加と、選択中の家具の操作を行う。
 * v4 の components/bottomsheets/（4,109 行）に相当する部分の最小版。
 *
 * UI は DOM。3D の上に重ねるだけなので three.js とは完全に切り離せる。
 *
 * **タブの並びはモードで変わる。** 部屋モードは内装と操作、写真モードは背景と操作。
 *
 * **家具を置くページはタブにしない。** 操作タブの［＋ 家具を追加］（家具を選んでいる間は名前の右の［＋］）を
 * 押すと家具のページ（ui/furniturePage.ts）が画面全体に開き、「×」で閉じると元のタブに戻る。
 * 家具を置いたときは、閉じて「操作」タブを出す
 */

import { isBillboard, type PlacedFurniture } from '@/config/furniture';
import type { EditableScene } from '@/core/furnitureScene';
import { createModelPanel } from '@/ui/modelPanel';
import { createFurniturePage } from '@/ui/furniturePage';
import { createPreviewImage } from '@/ui/previewImage';
import { createProductLink } from '@/ui/productLink';
import { createPhotoPanel } from '@/ui/photoPanel';
import { createInteriorPanel } from '@/ui/interiorPanel';
import { createIcon } from '@/ui/icons';
import { createSliderRow } from '@/ui/sliderRow';
import { activeScene, isPhotoMode, modeState } from '@/core/mode';
import { appState } from '@/core/appState';
import { releaseFurnitureAssets } from '@/core/modelLibrary';
import { beginEdit, canUndo, discardLater, editHistory, endEdit, recordEdit, undo } from '@/core/editHistory';
import { photoState, setFramingPhoto, setMasking, setScaling } from '@/core/photoState';

type TabId = 'interior' | 'background' | 'manage';

/**
 * 「操作」の行に敷くバーの決まりごと。
 *
 * いま使っているのは角度の行（向き・傾き）だけで、値は度。
 * 整数にしてあるのは、range が整数きざみのときにいちばん素直に動くため
 */
interface ManageSlider {
  min: number;
  max: number;
  /** バーの両端に添える文字。動かせる幅が見て分かるように */
  ends: [from: string, to: string];
  /** バーの右の「戻す」ボタン。置いたときの姿（0°）に戻しやすいように */
  reset: { value: number; label: string };
  valueOf(item: PlacedFurniture): number;
  onInput(value: number): void;
}

/**
 * 角度 1 つぶんのバーの設定。3 つの軸（向き・前後・左右）と板の傾きで同じ形になる。
 *
 * **ラジアンと度の行き来をここだけに閉じる。** 家具が持つのはラジアン、
 * バーが扱うのは度で、両方が行の組み立てに散らばると取り違えやすい
 */
function angleSlider(
  radiansOf: (item: PlacedFurniture) => number,
  apply: (radians: number) => void
): ManageSlider {
  return {
    min: ANGLE_LIMITS.min,
    max: ANGLE_LIMITS.max,
    ends: [`${ANGLE_LIMITS.min}°`, `+${ANGLE_LIMITS.max}°`],
    reset: { value: 0, label: '0°' },
    valueOf: (item) => signedDegrees(radiansOf(item)),
    onInput: (degrees) => apply(toRadians(degrees)),
  };
}

/**
 * 角度を -180〜180 の度数にする。何周も回したあとでもバーの位置が決まるように畳む。
 *
 * **両端はそのままにする。** -180° と +180° は同じ姿勢なので、畳むとどちらかに寄る。
 * 寄せると、バーを端まで引いたときにつまみが反対の端へ飛ぶ
 */
function signedDegrees(radians: number): number {
  const degrees = Math.round(toDegrees(radians));
  if (Math.abs(degrees) === 180) return degrees;
  const wrapped = ((degrees % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/**
 * 「大きさ」のバーの目盛りの数と、動かせる倍率（実寸に対する割合）。
 * バーの位置は倍率に正比例させず、掛け算で対応させる（50%〜200% を対数で）。
 * そうすると真ん中がちょうど 100%（実寸）になり、大きくするのも小さくするのも同じ手ざわりになる
 */
const SCALE_STEPS = 1000;
const SCALE_LIMITS = { min: 0.5, max: 2 };

function scaleToSlider(scale: number): number {
  const { min, max } = SCALE_LIMITS;
  const position = Math.log(scale / min) / Math.log(max / min);
  return Math.round(Math.min(1, Math.max(0, position)) * SCALE_STEPS);
}

function sliderToScale(value: number): number {
  const { min, max } = SCALE_LIMITS;
  return min * (max / min) ** (value / SCALE_STEPS);
}

/** 置いた家具の、実寸（置いたときの大きさ）に対する割合。実寸を覚えていない古い記録は 100% とみなす */
function scaleOf(item: PlacedFurniture): number {
  return item.baseSize && item.baseSize[1] > 0 ? item.size[1] / item.baseSize[1] : 1;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

const TABS: Record<TabId, string> = {
  interior: '内装',
  background: '背景',
  manage: '操作',
};

/**
 * モードごとのタブの並び。部屋は内装（壁と床）、写真は背景（部屋の写真）から始まる。
 * 家具を置くページは、タブではなく操作タブの［＋ 家具を追加］から開く（ページは画面全体に開くので、タブの中身が無い）
 */
const ROOM_TABS: TabId[] = ['interior', 'manage'];
const PHOTO_TABS: TabId[] = ['background', 'manage'];


/**
 * 角度のバーの範囲。**真ん中が 0°**、つまり置いたときの姿勢になる。
 *
 * 0〜360 にすると、いじっていない家具のつまみが左端に張り付く。
 * 真ん中から左右に振れる形なら、「どちらへどれだけ動かしたか」が一目で分かる
 */
const ANGLE_LIMITS = { min: -180, max: 180 };

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

  // 生成は8分かかり、その間もページを開け閉めできる必要がある。
  // 毎回作り直すと進行表示が途切れるので、1つ作って使い回す。
  // 置いたら家具のページを閉じ、「操作」タブを出す。置いた家具がすぐ見え、向きや大きさをすぐ変えられる
  const modelPanel = createModelPanel({
    onPlaced: (id) => {
      justPlacedId = id;
      closeFurniturePage();
      activeTab = 'manage';
      render();
    },
  });
  const furniturePage = createFurniturePage(modelPanel.element, closeFurniturePage);
  container.appendChild(furniturePage.element);

  /**
   * 家具のページを閉じる。開いていた姿（追加・3D モデルを作る・編集・高さの入力）はすべて閉じて一覧に戻す。
   * 次に開いたとき、前の途中の姿が残らないように
   */
  function closeFurniturePage(): void {
    furniturePage.close();
    modelPanel.showHome();
  }
  const photoPanel = createPhotoPanel();
  const interiorPanel = createInteriorPanel();

  function visibleTabs(): TabId[] {
    return isPhotoMode() ? PHOTO_TABS : ROOM_TABS;
  }

  function render(): void {
    const tabs = visibleTabs();

    // モードを変えた直後は、前のモードにしか無いタブを開いていることがある
    if (!tabs.includes(activeTab)) activeTab = tabs[0];

    // 手前の範囲の指定も大きさ合わせも「背景」タブの中で行う。タブを離れたら終える。
    // **終えないと 1 本指がそちらに取られたままになり、家具を動かせなくなる。**
    // 家具をタップすると「操作」タブへ移るので、それもここで終わる
    if (activeTab !== 'background') {
      setMasking(false);
      setScaling(false);
      setFramingPhoto(false);
    }

    tabBar.replaceChildren(
      ...tabs.map((tab) => {
        const button = document.createElement('button');
        button.className = 'sheet__tab';
        button.classList.toggle('is-active', tab === activeTab);
        button.textContent = TABS[tab];
        button.addEventListener('click', () => {
          // タブを離れたら、一覧のチェックを付けている途中でも終える
          if (tab !== activeTab) checked = null;
          activeTab = tab;
          render();
        });
        return button;
      })
    );

    disposeList();
    body.replaceChildren(renderActiveTab());
  }


  function renderActiveTab(): HTMLElement {
    // 自分で状態を購読して描き替えるパネルは、作り直さず使い回す
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
  /**
   * いま出している家具の一覧（何も選んでいないとき）。
   *
   * **一覧に出ている中身が変わったときだけ作り直す。** 選んでいない家具を指で動かすと、
   * 位置が変わるたびに状態が届く。そのたびに作り直すと、アイコンを読み直す間だけ枠が空になり、チラつく
   */
  let listView: { key: string; dispose(): void } | null = null;

  /** 一覧に出ている中身（並び・名前・アイコン・色と、削除の直後の一言）。位置や大きさは入れない */
  function listKey(furniture: PlacedFurniture[]): string {
    const items = furniture.map((item) => [item.id, item.name, item.typeId, item.imageUrl, item.sourceImageKey, item.color]);
    return JSON.stringify([items, checked !== null]);
  }

  /** 一覧のアイコンが読み込んだ画像を解放する。一覧を画面から外すときに呼ぶ */
  function disposeList(): void {
    listView?.dispose();
    listView = null;
  }
  /**
   * 操作タブの下の段。左に「ひとつ戻す」、その隣に「初期値に戻す」、右端に「画面から削除」
   * （初期値に戻すと画面から削除は、家具を選んでいるときだけ）。
   * スクロールしても下に残す（背景の調整の画面の下の段と同じ並び）。
   * タブを描き直しても作り直さず使い回し、戻せるかどうかは履歴が変わるたびに書き替える
   */
  const manageFoot = (() => {
    const element = document.createElement('div');
    element.className = 'manage__bar';
    const undoButton = createButton('ひとつ戻す', () => undo(activeScene()), 'is-quiet is-small');
    const resetButton = createButton('初期値に戻す', () => {
      const { selectedId } = activeScene().state();
      if (selectedId) resetItem(selectedId);
    }, 'is-quiet is-small');
    // **消えるのは置いた分だけで、いつでも置き直せる。** 家具そのものを消す赤いボタンと
    // 同じ見た目にすると同じ重さに見えるので、グレーにして、消したあと一覧にその旨を出す
    const removeButton = createButton('画面から削除', () => {
      const scene = activeScene();
      const { selectedId, furniture } = scene.state();
      const item = furniture.find((entry) => entry.id === selectedId);
      if (!item) return;
      removeFromScreen(scene, [item]);
    }, 'is-small manage__delete manage__bar-end');
    // 一覧でチェックを付けた家具を、まとめて画面から外す（色は上と同じグレー。消えるのは置いた分だけ）
    const removeCheckedButton = createButton('', removeChecked, 'is-small manage__delete manage__bar-end');
    element.append(undoButton, resetButton, removeButton, removeCheckedButton);
    const refresh = (): void => {
      const scene = activeScene();
      const hasSelection = scene.state().furniture.some((item) => item.id === scene.state().selectedId);
      undoButton.disabled = !canUndo(scene);
      // チェックを付けている間は、まとめて外すボタンだけを出す。1 つも付けていなければ出さない（押しても何も起きない）
      undoButton.hidden = checked !== null;
      resetButton.hidden = !hasSelection;
      removeButton.hidden = !hasSelection;
      removeCheckedButton.hidden = !checked || checked.size === 0;
      if (checked) removeCheckedButton.textContent = `画面から削除（${checked.size} 個）`;
    };
    editHistory.subscribe(refresh);
    return { element, refresh };
  })();

  /** 「細かく調整」を開いているか。別の家具を選んでも開いたままにする */
  let moreOpen = false;
  /**
   * 一覧で、画面から外す家具にチェックを付けている最中なら、チェックを付けた家具の id。ふだんは null。
   * 一覧の「選択」で始め、「キャンセル」か、外し終えたとき、家具を選んだときに終える
   */
  let checked: Set<string> | null = null;

  /** チェックを付けた家具を、まとめて画面から外す。ひとつ戻すでは、まとめて 1 回で戻る */
  function removeChecked(): void {
    const scene = activeScene();
    const items = scene.state().furniture.filter((item) => checked?.has(item.id));
    checked = null;
    if (items.length === 0) {
      render();
      return;
    }
    removeFromScreen(scene, items);
    render();
  }


  /** 選択中の家具に対する操作 */
  function renderManageTab(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'manage';
    manageView = null;

    const scene = activeScene();
    const { selectedId, furniture } = scene.state();
    const selected = furniture.find((f) => f.id === selectedId);

    if (!selected) {
      // 消えた家具のチェックは外す
      if (checked) checked = new Set([...checked].filter((id) => furniture.some((item) => item.id === id)));
      const icons: ReturnType<typeof createPreviewImage>[] = [];
      wrapper.append(createFurnitureList(furniture, icons), manageFoot.element);
      listView = { key: listKey(furniture), dispose: () => icons.forEach((icon) => icon.dispose()) };
      manageFoot.refresh();
      return wrapper;
    }
    // 家具を選んだら、チェックを付けている途中でも終える
    checked = null;

    const { id } = selected;
    // 見出し: どの家具を触っているか（画面から削除は下の段の右端）
    const head = document.createElement('div');
    head.className = 'manage__head';
    const name = document.createElement('span');
    name.className = 'manage__name';
    name.textContent = selected.name ?? '家具';
    // 家具を選んでいる間も、続けて家具を置けるように、名前の右に小さな［＋］を置く
    head.append(name, createAddButton('small'));

    // ふだん使う行: 向き（板なら傾き）と大きさ。
    // 実寸は「家具を追加」のページの編集で決める。ここの大きさは、置いたこの 1 つだけを実寸の何 % で見せるか
    const rows: ReturnType<typeof createManageRow>[] = [];
    // 切り抜きの板はカメラの方を向くので、向きも前後の傾きも効かない。
    // 板に効くのは画面の中で回す「傾き」だけ
    rows.push(
      isBillboard(selected)
        ? createManageRow('傾き', angleSlider(
            (item) => item.tilt ?? 0,
            (radians) => update(id, { tilt: radians })
          ))
        : createManageRow('向き', angleSlider(
            (item) => item.rotationY,
            (radians) => setRotation(id, radians)
          )),
      createScaleRow(id)
    );

    // めったに使わないものは畳む。写真の傾きが合わないときの補正と、やり直し
    const more = document.createElement('details');
    more.className = 'manage__more';
    more.open = moreOpen;
    more.addEventListener('toggle', () => {
      moreOpen = more.open;
    });
    const summary = document.createElement('summary');
    summary.className = 'manage__more-summary';
    summary.textContent = '細かく調整';
    const moreBody = document.createElement('div');
    moreBody.className = 'manage__more-body';
    const moreRows: ReturnType<typeof createManageRow>[] = [];
    if (!isBillboard(selected)) {
      moreRows.push(
        createManageRow('前後の傾き', angleSlider(
          (item) => item.pitch ?? 0,
          (radians) => update(id, { pitch: radians })
        )),
        createManageRow('左右の傾き', angleSlider(
          (item) => item.roll ?? 0,
          (radians) => update(id, { roll: radians })
        ))
      );
    }
    // 床からの高さは、家具の真上の上下のつまみで変える（interaction/liftHandle.ts）。バーは置かない
    moreBody.append(...moreRows.map((row) => row.element));
    // 商品ページから取り込んだ家具なら、ここから買いに行ける
    if (selected.product) {
      const productRow = document.createElement('div');
      productRow.className = 'manage__product';
      productRow.append(createProductLink(selected.product));
      moreBody.append(productRow);
    }
    more.append(summary, moreBody);

    // 畳む中身が無い（切り抜きの板で、商品ページも無い）なら、「細かく調整」ごと出さない
    const hasMore = moreBody.childElementCount > 0;
    wrapper.append(head, ...rows.map((row) => row.element), ...(hasMore ? [more] : []), manageFoot.element);
    manageFoot.refresh();

    const allRows = [...rows, ...moreRows];
    manageView = {
      itemId: id,
      refresh: (item) => allRows.forEach((row) => row.refresh(item)),
    };
    manageView.refresh(selected);
    return wrapper;
  }

  /** 「操作」タブの 1 行。家具から値を取り出すところだけがここの仕事 */
  function createManageRow(
    label: string,
    slider: ManageSlider
  ): { element: HTMLElement; refresh(item: PlacedFurniture): void } {
    const row = createSliderRow({ label, ...trackEdits(slider) });
    return {
      element: row.element,
      refresh: (item) => row.setValue(slider.valueOf(item)),
    };
  }

  /**
   * バーの操作を履歴に残すようにする。動かし始めた姿を控え、離したときに 1 回の操作として積む
   * （ひとつ戻すで、動かす前の姿に戻る）
   */
  function trackEdits<T extends { onInput(value: number): void }>(slider: T): T & { onChange(): void } {
    return {
      ...slider,
      onInput: (value: number) => {
        beginEdit(activeScene());
        slider.onInput(value);
      },
      onChange: () => endEdit(activeScene()),
    };
  }

  /**
   * 「大きさ」の行。置いたこの 1 つだけを、実寸の 50%〜200% で見せる。右のボタンで 100% に戻せる
   * （バーの真ん中が 100% = 実寸。背景の写真で縮尺がずれて見えるときの調整用）
   */
  function createScaleRow(id: string): { element: HTMLElement; refresh(item: PlacedFurniture): void } {
    const row = createSliderRow({
      label: '大きさ',
      min: 0,
      max: SCALE_STEPS,
      ends: ['50%', '200%'],
      // 100% = 実寸に戻すボタン
      reset: { value: scaleToSlider(1), label: '100%' },
      ...trackEdits({ onInput: (value: number) => setScale(id, sliderToScale(value)) }),
    });
    return {
      element: row.element,
      refresh: (item) => row.setValue(scaleToSlider(scaleOf(item))),
    };
  }

  /** 置いたこの 1 つの大きさを、実寸に対する割合で決める。回した向きのまま置ける範囲へ押し戻す */
  function setScale(id: string, scale: number): void {
    const scene = activeScene();
    const item = scene.state().furniture.find((f) => f.id === id);
    if (!item?.baseSize) return;
    const size: [number, number, number] = [item.baseSize[0] * scale, item.baseSize[1] * scale, item.baseSize[2] * scale];
    scene.update(id, { size, position: scene.constrain(item.position, size, item.rotationY) });
  }

  /**
   * 家具を置くページを開くボタン。
   * tile: 一覧の先頭のタイル（＋と「家具を追加」）。small: 選んでいる家具の名前の右に置く小さな丸（＋だけ）
   */
  function createAddButton(kind: 'tile' | 'small'): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = kind === 'tile' ? 'manage__tile manage__add' : 'manage__add-small';
    button.append(createIcon('plus'));
    if (kind === 'tile') {
      const label = document.createElement('span');
      label.textContent = '家具を追加';
      button.append(label);
    } else {
      button.setAttribute('aria-label', '家具を追加');
    }
    button.addEventListener('click', () => furniturePage.open());
    return button;
  }

  /**
   * 置いてある家具の一覧。何も選んでいないときに出す。横 4 つのタイルの格子で、先頭は［＋ 家具を追加］。
   *
   * 画面の外に出てしまった家具や、大きくしすぎて掴めない家具は、画面をタップしても
   * 選べない。一覧からなら選べる。タイルを押すと選択になり、操作の行に切り替わる。
   * 「選択」を押すと、タイルにチェックを付けて、まとめて画面から外せる（外すボタンは下の段）。
   *
   * **説明の一言は出さない。** タイルは押せる見た目で、チェックの丸と下の段の「画面から削除（N 個）」で
   * 選んだ数も分かる。外したことはタイルが消えて分かり、間違えてもひとつ戻すで戻せる
   */
  function createFurnitureList(furniture: PlacedFurniture[], icons: ReturnType<typeof createPreviewImage>[]): HTMLElement {
    const list = document.createElement('div');
    list.className = 'manage__list';
    const scene = activeScene();

    // 見出しの行: 右端に「選択」／「キャンセル」。家具が 1 つも無ければ、選ぶものが無いので行ごと出さない
    if (furniture.length > 0) {
      const top = document.createElement('div');
      top.className = 'manage__top';
      const toggle = createButton(checked ? 'キャンセル' : '選択', () => {
        checked = checked ? null : new Set();
        render();
      }, 'is-text is-small manage__check-toggle');
      top.append(toggle);
      list.append(top);
    }

    const grid = document.createElement('div');
    grid.className = 'manage__grid';
    const add = createAddButton('tile');
    // チェックを付けている間は押せない（押すと家具のページが開いて、付けたチェックの意味が分からなくなる）
    add.disabled = checked !== null;
    grid.append(add);
    for (const item of furniture) {
      const name = item.name ?? item.typeId;
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'manage__tile';
      tile.title = name;
      tile.setAttribute('aria-label', name);
      const icon = document.createElement('span');
      icon.className = 'manage__icon';
      if (item.imageUrl || item.sourceImageKey) {
        const preview = createPreviewImage(icon);
        preview.show({ cutoutKey: item.imageUrl, previewKey: item.sourceImageKey });
        icons.push(preview);
      } else {
        icon.style.background = item.color;
      }
      tile.append(icon);
      if (checked) {
        const mark = document.createElement('span');
        mark.className = 'manage__check';
        mark.setAttribute('aria-hidden', 'true');
        tile.append(mark);
        tile.setAttribute('aria-pressed', String(checked.has(item.id)));
        tile.classList.toggle('is-checked', checked.has(item.id));
      }
      tile.addEventListener('click', () => {
        if (!checked) {
          scene.select(item.id);
          return;
        }
        // チェックを付け外しする。一覧は作り直さず、このタイルと下の段だけを書き替える（アイコンがチラつかない）
        if (checked.has(item.id)) checked.delete(item.id);
        else checked.add(item.id);
        tile.classList.toggle('is-checked', checked.has(item.id));
        tile.setAttribute('aria-pressed', String(checked.has(item.id)));
        manageFoot.refresh();
      });
      grid.append(tile);
    }
    list.append(grid);
    return list;
  }

  /**
   * バーで変えた分をすべて置いたときの姿に戻す。
   *
   * **床の上のどこにいるかは動かさない。** 前後左右の位置はバーで変えるものではなく、
   * 指で置いた場所なので、ここで動かすと「戻した」つもりが家具を見失う
   */
  function resetItem(id: string): void {
    const scene = activeScene();
    const item = scene.state().furniture.find((f) => f.id === id);
    if (!item) return;

    // 置いたときの大きさを覚えていない古い記録もあるので、その場合は大きさを変えない
    const size = item.baseSize ? ([...item.baseSize] as [number, number, number]) : item.size;
    const [x, , z] = item.position;
    recordEdit(scene, () => scene.update(id, {
      rotationY: 0,
      pitch: 0,
      roll: 0,
      tilt: 0,
      size,
      position: scene.constrain([x, 0, z], size, 0),
    }));
  }

  /**
   * 置いた家具を画面から消す。ひとつ戻すで戻せるよう、中身（3D や切り抜き）は戻せなくなるまで捨てない
   * （保管庫にも他の家具にも使われていなければ、そのときに捨てる）
   */
  function removeFromScreen(scene: EditableScene, items: PlacedFurniture[]): void {
    beginEdit(scene);
    for (const item of items) {
      scene.remove(item.id);
      discardLater(scene, () => releaseFurnitureAssets(item));
    }
    endEdit(scene);
  }

  /** 家具のどれか 1 つの値を差し替える。傾きのように、位置を丸め直す必要がないもの向け */
  function update(id: string, patch: Partial<PlacedFurniture>): void {
    const scene = activeScene();
    if (!scene.state().furniture.some((f) => f.id === id)) return;
    scene.update(id, patch);
  }

  /**
   * 家具を回す。
   *
   * 回すと上から見た輪郭が広がるため、壁ぎわの家具はそのままだと壁を突き抜ける。
   * 回転後の向きで位置を計算し直し、置ける範囲へ押し戻す
   * （写真モードには壁が無いので、そのモードでは何も動かない）。
   */
  function setRotation(id: string, rotationY: number): void {
    const scene = activeScene();
    const item = scene.state().furniture.find((f) => f.id === id);
    if (!item) return;
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
    // 一覧を出していて、一覧の中身が変わっていなければそのまま（動かしただけなど）
    if (!selectedId && listView?.key === listKey(furniture)) return;
    render();
  };
  appState.subscribe(followSelection);
  photoState.subscribe(followSelection);

  // モードが変わったら、そのモードの最初のタブへ戻す。
  // 操作タブは両方にあるので、そのままだと写真モードに入っても開いたままになり、
  // 先にやるべき「背景の写真を選ぶ」に辿り着けない
  modeState.subscribe(() => {
    activeTab = visibleTabs()[0];
    checked = null;
    previousSelectedId = activeScene().state().selectedId;
    render();
  });

  render();
}
