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
import { createIcon } from '@/ui/icons';
import { activeScene, isPhotoMode, modeState } from '@/core/mode';
import { appState } from '@/core/appState';
import { releaseFurnitureAssets } from '@/core/modelLibrary';
import { photoState, setMasking } from '@/core/photoState';

type TabId = 'interior' | 'background' | 'models' | 'manage';

/**
 * 「操作」の行に敷くバーの決まりごと。
 *
 * **値の単位は行ごとに違う。** 向きと傾きは度、高さはセンチ、大きさは目盛りの番号。
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

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function longestOf(size: [number, number, number]): number {
  return Math.max(...size);
}

/** 置いたときの何倍かを、バーの目盛りの番号にする（等倍が 0＝真ん中） */
function ratioToSlider(ratio: number): number {
  const position = Math.log(Math.max(1e-6, ratio)) / Math.log(SIZE_MAX_RATIO);
  return Math.round(clamp(position, -1, 1) * SIZE_SLIDER_STEPS);
}

/** バーの目盛りの番号を、置いたときの何倍かにする */
function sliderToRatio(value: number): number {
  return SIZE_MAX_RATIO ** (value / SIZE_SLIDER_STEPS);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

/** 大きさの上限と下限（いちばん長い辺、メートル）。行き過ぎて見失わないように止める */
const SIZE_LIMITS = { min: 0.1, max: 5 };

/**
 * 大きさのバーは「置いたときの何倍か」で動く。**真ん中が等倍**、端が 5 倍と 1/5 倍。
 *
 * メートルで持たないのは、真ん中が家具ごとに変わってしまうため。
 * 倍率なら、どの家具でも真ん中が「置いたときのまま」になる
 */
const SIZE_MAX_RATIO = 5;

/**
 * 大きさのバーの目盛りの数（片側）。
 *
 * **バーの位置は倍率に正比例させず、掛け算で対応させる。** そうすると、
 * 指を同じだけ動かせば、小さくても大きくても同じ割合だけ変わる
 */
const SIZE_SLIDER_STEPS = 1000;

/** 高さの範囲（メートル）。写真モードには床が無いので、下にも行けるようにしてある */
const HEIGHT_LIMITS = { min: -2.5, max: 2.5 };

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
    // 「大きさ」のバーが基準にする、置いたときのいちばん長い辺。
    // 置いたあとに変えても動かない値なので、行を組むときに 1 度だけ読めばよい
    const baseLongest = longestOf(selected.baseSize ?? selected.size);
    const rows: ReturnType<typeof createManageRow>[] = [];
    // 切り抜きの板はカメラの方を向くので、向きも前後の傾きも効かない。
    // 板に効くのは画面の中で回す「傾き」だけ
    if (isBillboard(selected)) {
      rows.push(
        createManageRow('傾き', angleSlider(
          (item) => item.tilt ?? 0,
          (radians) => update(id, { tilt: radians })
        ))
      );
    } else {
      rows.push(
        createManageRow('向き', angleSlider(
          (item) => item.rotationY,
          (radians) => setRotation(id, radians)
        )),
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
    rows.push(
      createManageRow('大きさ', {
        min: -SIZE_SLIDER_STEPS,
        max: SIZE_SLIDER_STEPS,
        ends: [`×1/${SIZE_MAX_RATIO}`, `×${SIZE_MAX_RATIO}`],
        valueOf: (item) => ratioToSlider(longestOf(item.size) / baseLongest),
        onInput: (value) => setLongestEdge(id, baseLongest * sliderToRatio(value)),
      }),
      createManageRow('高さ', {
        min: HEIGHT_LIMITS.min * 100,
        max: HEIGHT_LIMITS.max * 100,
        ends: [`${HEIGHT_LIMITS.min} m`, `+${HEIGHT_LIMITS.max} m`],
        // バーは 1cm きざみ。メートルのままだと小数の丸めでつまみが落ち着かない
        valueOf: (item) => Math.round(item.position[1] * 100),
        onInput: (centimetres) => setHeight(id, centimetres / 100),
      })
    );

    // 削除は右下に寄せる（誤タップを避ける）。
    // **消えるのは置いた分だけで、いつでも置き直せる。** 家具そのものを消す赤いボタンと
    // 同じ見た目にすると同じ重さに見えるので、グレーにして下に残ることを添える
    const foot = document.createElement('div');
    foot.className = 'manage__foot';
    // 商品ページから取り込んだ家具なら、ここから買いに行ける（削除の左に置く）
    if (selected.product) foot.append(createProductLink(selected.product));
    // いじりすぎて分からなくなったときに戻れる場所。動かすバーが 5 本あるので、
    // 1 本ずつ真ん中へ戻すのは現実的ではない
    foot.append(createButton('初期値に戻す', () => resetItem(id), 'is-quiet is-small'));
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
   * 「見出し」とバーの 1 行。
   *
   * **数字は出さない。** 出すとバーと数字の 2 か所を見比べることになるうえ、
   * 画面の中の家具そのものが答えなので、そちらを見ていればよい。
   * 動かせる幅だけはバーの両端に添える（どこまで行けるかは触る前に知りたいため）
   */
  function createManageRow(
    label: string,
    slider: ManageSlider
  ): { element: HTMLElement; refresh(item: PlacedFurniture): void } {
    const element = document.createElement('div');
    element.className = 'manage__row';

    const heading = document.createElement('span');
    heading.className = 'manage__label';
    heading.textContent = label;

    const bar = createManageSlider(label, slider);
    element.append(heading, bar.element);
    return { element, refresh: bar.refresh };
  }

  /**
   * バー本体と、両端の目安。
   *
   * **つまみを動かしている間は、原則として書き戻さない。** 状態が変わるたびに
   * refresh が来るので、書き戻すと丸めの差でつまみが指の下から逃げる。
   * ただし**丸めでは説明できないほど離れたときは書き戻す**。部屋モードで床より下へ
   * 引いたときのように置ける範囲で止められた場合に、つまみがそこで止まって見える
   */
  function createManageSlider(
    label: string,
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
    input.setAttribute('aria-label', `${label}を変える`);

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
        const actual = slider.valueOf(item);
        if (!holding || Math.abs(actual - Number(input.value)) > 1) {
          input.value = String(actual);
        }
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
    scene.update(id, {
      rotationY: 0,
      pitch: 0,
      roll: 0,
      tilt: 0,
      size,
      position: scene.constrain([x, 0, z], size, 0),
    });
  }

  /** 家具のどれか 1 つの値を差し替える。傾きのように、位置を丸め直す必要がないもの向け */
  function update(id: string, patch: Partial<PlacedFurniture>): void {
    const scene = activeScene();
    if (!scene.state().furniture.some((f) => f.id === id)) return;
    scene.update(id, patch);
  }

  /**
   * 家具の大きさを、いちばん長い辺がこの長さになるように変える。
   * 3 辺そろえて掛けるので形は変わらない。
   *
   * 部屋モードでは大きくした結果が壁を突き抜けることがあるので、位置を丸め直す
   */
  function setLongestEdge(id: string, longest: number): void {
    const scene = activeScene();
    const item = scene.state().furniture.find((f) => f.id === id);
    if (!item) return;

    // 倍率で動かすので、家具によっては上限を超える。実寸としての限度はここで止める
    const ratio = clamp(longest, SIZE_LIMITS.min, SIZE_LIMITS.max) / longestOf(item.size);
    const size = item.size.map((edge) => edge * ratio) as [number, number, number];
    scene.update(id, {
      size,
      position: scene.constrain(item.position, size, item.rotationY),
    });
  }

  /** 家具の高さを決める。下限はモードが決める（部屋なら床、写真なら無し） */
  function setHeight(id: string, y: number): void {
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
