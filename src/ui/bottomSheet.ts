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
import type { EditableScene } from '@/core/furnitureScene';
import { createModelPanel } from '@/ui/modelPanel';
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

type TabId = 'interior' | 'background' | 'models' | 'manage';

/**
 * 「操作」の行に敷くバーの決まりごと。
 *
 * **値の単位は行ごとに違う。** 向きと傾きは度、床からの高さはセンチ。
 * どれも整数にしてあるのは、range が整数きざみのときにいちばん素直に動くため
 */
interface ManageSlider {
  min: number;
  max: number;
  /** バーの両端に添える文字。動かせる幅が見て分かるように */
  ends: [from: string, to: string];
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
  models: '家具',
  manage: '操作',
};

/** モードごとのタブの並び。部屋は内装（壁と床）、写真は背景（部屋の写真）から始まる */
const ROOM_TABS: TabId[] = ['interior', 'models', 'manage'];
const PHOTO_TABS: TabId[] = ['background', 'models', 'manage'];

/** 床からの高さの範囲（メートル）。写真モードには床が無いので、下にも行けるようにしてある */
const FLOOR_OFFSET_LIMITS = { min: -2.5, max: 2.5 };

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
  /**
   * 操作タブの下の段。左に「ひとつ戻す」、その隣に「初期値に戻す」（家具を選んでいるときだけ）。
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
    element.append(undoButton, resetButton);
    const refresh = (): void => {
      const scene = activeScene();
      undoButton.disabled = !canUndo(scene);
      resetButton.hidden = !scene.state().furniture.some((item) => item.id === scene.state().selectedId);
    };
    editHistory.subscribe(refresh);
    return { element, refresh };
  })();

  /** 「細かく調整」を開いているか。別の家具を選んでも開いたままにする */
  let moreOpen = false;
  /** 「画面から削除」の直後に一覧へ出す一言。次に家具を選ぶまで残す */
  let removedNote: string | null = null;

  /** 削除の直後なら、その旨を一覧の下に出す */
  function appendRemovedNote(list: HTMLElement): void {
    if (!removedNote) return;
    const note = document.createElement('p');
    note.className = 'hint manage__removed';
    note.textContent = removedNote;
    list.append(note);
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
      wrapper.append(createFurnitureList(furniture), manageFoot.element);
      manageFoot.refresh();
      return wrapper;
    }
    removedNote = null;

    const { id } = selected;
    // 見出し: どの家具を触っているか。削除もここ（行の下に並べるより、家具の名前の隣が自然）
    const head = document.createElement('div');
    head.className = 'manage__head';
    const name = document.createElement('span');
    name.className = 'manage__name';
    name.textContent = selected.name ?? '家具';
    // **消えるのは置いた分だけで、いつでも置き直せる。** 家具そのものを消す赤いボタンと
    // 同じ見た目にすると同じ重さに見えるので、グレーにして、消したあと一覧にその旨を出す
    const remove = createButton('', () => {
      // 消すと同時に一覧が描かれるので、一言は消す前に用意する
      removedNote = `「${selected.name ?? '家具'}」を画面から削除しました。「家具」タブには残っています`;
      removeFromScreen(scene, selected);
    }, 'is-small manage__delete manage__delete--icon');
    remove.setAttribute('aria-label', '画面から削除');
    remove.append(createIcon('trash'));
    head.append(name, remove);

    // ふだん使う行: 向き（板なら傾き）と大きさ。
    // 実寸は「家具」タブの編集で決める。ここの大きさは、置いたこの 1 つだけを実寸の何 % で見せるか
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
    moreRows.push(
      createManageRow('床からの高さ', {
        min: FLOOR_OFFSET_LIMITS.min * 100,
        max: FLOOR_OFFSET_LIMITS.max * 100,
        ends: [`${FLOOR_OFFSET_LIMITS.min} m`, `+${FLOOR_OFFSET_LIMITS.max} m`],
        // バーは 1cm きざみ。メートルのままだと小数の丸めでつまみが落ち着かない
        valueOf: (item) => Math.round(item.position[1] * 100),
        onInput: (centimetres) => setFloorOffset(id, centimetres / 100),
      })
    );
    moreBody.append(...moreRows.map((row) => row.element));
    // 商品ページから取り込んだ家具なら、ここから買いに行ける
    if (selected.product) {
      const productRow = document.createElement('div');
      productRow.className = 'manage__product';
      productRow.append(createProductLink(selected.product));
      moreBody.append(productRow);
    }
    more.append(summary, moreBody);

    wrapper.append(head, ...rows.map((row) => row.element), more, manageFoot.element);
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
   * 「大きさ」の行。置いたこの 1 つだけを、実寸の 50%〜200% で見せる。右に今の割合を出す
   * （バーの真ん中が 100% = 実寸。背景の写真で縮尺がずれて見えるときの調整用）
   */
  function createScaleRow(id: string): { element: HTMLElement; refresh(item: PlacedFurniture): void } {
    const percent = document.createElement('span');
    percent.className = 'slider-row__after manage__percent';
    const row = createSliderRow({
      label: '大きさ',
      min: 0,
      max: SCALE_STEPS,
      ends: ['50%', '200%'],
      ...trackEdits({ onInput: (value: number) => setScale(id, sliderToScale(value)) }),
      after: percent,
    });
    return {
      element: row.element,
      refresh: (item) => {
        row.setValue(scaleToSlider(scaleOf(item)));
        percent.textContent = `${Math.round(scaleOf(item) * 100)}%`;
      },
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
      appendRemovedNote(list);
      return list;
    }
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = '家具をタップすると選択できます。画面の外にある家具は、この一覧から選べます';
    list.append(hint);
    appendRemovedNote(list);

    const scene = activeScene();
    for (const item of furniture) {
      const row = document.createElement('div');
      row.className = 'manage__item';

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'manage__pick';
      const icon = document.createElement('span');
      icon.className = 'manage__icon';
      if (item.imageUrl || item.sourceImageKey) {
        createPreviewImage(icon).show({ cutoutKey: item.imageUrl, previewKey: item.sourceImageKey });
      } else {
        icon.style.background = item.color;
      }
      const name = document.createElement('span');
      name.className = 'manage__name';
      name.textContent = item.name ?? item.typeId;
      pick.append(icon, name);
      pick.addEventListener('click', () => scene.select(item.id));

      const remove = createButton('', () => removeFromScreen(scene, item), 'is-small manage__delete');
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
  function removeFromScreen(scene: EditableScene, item: PlacedFurniture): void {
    beginEdit(scene);
    scene.remove(item.id);
    discardLater(scene, () => releaseFurnitureAssets(item));
    endEdit(scene);
  }

  /** 家具のどれか 1 つの値を差し替える。傾きのように、位置を丸め直す必要がないもの向け */
  function update(id: string, patch: Partial<PlacedFurniture>): void {
    const scene = activeScene();
    if (!scene.state().furniture.some((f) => f.id === id)) return;
    scene.update(id, patch);
  }

  /** 床からの高さを決める。下限はモードが決める（部屋なら床、写真なら無し） */
  function setFloorOffset(id: string, y: number): void {
    const scene = activeScene();
    const item = scene.state().furniture.find((f) => f.id === id);
    if (!item) return;

    const [x, , z] = item.position;
    scene.update(id, {
      position: scene.constrain([x, y, z], item.size, item.rotationY),
    });
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
