/**
 * 「家具」タブ。置ける家具をタイルの格子に並べ、押すといまのモード（部屋／写真）に置く。
 *
 *   格子の先頭 … 「＋ 追加」。押すと一覧と入れ替わりに「家具を追加」の姿が出る。
 *                入口は 2 つで、2D（切り抜き）を作る（数秒）／3D モデルを作る（数分）。
 *                匿名ならその姿の中でログインを求める（ui/loginPanel.ts）。
 *                3D は 2D から作るので、作る前に元の 2D を選ばせる
 *   続き       … 作った家具。作成中はその場で円が進み、できあがると押せる姿になる。
 *                失敗は「!」のタイルで、押すと格子の下に理由と「とじる」が出る。
 *                押すと出るメニューの［編集］で、編集の姿（アイコン・名前・サイズ・削除）に切り替わる。
 *
 * 格子の上の「すべて / 2D / 3D」で絞れる。最初から入っている椅子・ソファ（サンプル）も作った家具と同じ扱い。2D は切り抜きの板、3D は向きを変えられるモデル。
 *
 * **2D と 3D は別々のタイルとして並ぶ。** 同じ家具でも 2 つ出るので、それぞれ選んで
 * 編集・削除する。どちらを触っているのかが分かるよう、左上に 2D / 3D の印を付ける。
 *
 * 3D 生成は約 3 分かかるので、**待たせる画面ではなく、待たせない画面**にする。
 * ここは進み具合を映すだけで、進行そのものは core/generation.ts と core/cutout.ts が持っている。
 */

import type { PlacedFurniture } from '@/config/furniture';
import { IS_CONFIGURED } from '@/config/api';
import { activeScene, isPhotoMode } from '@/core/mode';
import { progressFor } from '@/core/progress';
import {
  dismissError,
  generationState,
  startGenerationForModel,
  type GenerationJob,
} from '@/core/generation';
import {
  cutoutProgress,
  cutoutState,
  dismissCutoutError,
  startCutout,
  type CutoutJob,
} from '@/core/cutout';
import { createProductLink } from '@/ui/productLink';
import {
  PLACEHOLDER_COLOR,
  modelLibrary,
  removeModelFacet,
  renamePlacedCopies,
  updateModel,
  type GeneratedModel,
  type ModelFacet,
} from '@/core/modelLibrary';
import { authState, redirectLogin } from '@/platform/auth';
import { walletState, remainingGenerations } from '@/core/wallet';
import { NO_CREDITS_MESSAGE } from '@/platform/api';
import { pickImages } from '@/platform/picker';
import { createHeightStep } from '@/ui/heightStep';
import { createSizeField } from '@/ui/sizeField';
import { placementSize, setModelHeight } from '@/core/furnitureHeight';
import { createIcon, type IconName } from '@/ui/icons';
import { createLoginPanel } from '@/ui/loginPanel';
import { createPreviewImage } from '@/ui/previewImage';
import { createProgressRing } from '@/ui/progressRing';

export interface ModelPanelOptions {
  /** モデルを置いた直後に呼ぶ。タブの移動を抑える判断に使う */
  onPlaced(id: string): void;
}

/** 格子の絞り込み */
/**
 * 格子の絞り込み。作ったものは「できたものが何か」で分ける。
 * 2D は写真や商品ページから切り抜いた板（正面からしか見えない）、3D は向きを変えて置けるモデル
 */
type Filter = 'all' | 'flat' | 'solid';
const FILTERS: Record<Filter, string> = { all: 'すべて', flat: '2D', solid: '3D' };

/** 家具の作り方。「家具を追加」の 2 行 */
type Way = 'cutout' | 'model';

/**
 * 一覧に並べる 1 タイル。**同じ家具でも 2D と 3D で別のタイル**になるので、
 * どちらの面を指しているかを持つ。id はタイルを使い回すための鍵
 */
interface ModelTile {
  id: string;
  model: GeneratedModel;
  facet: ModelFacet;
}

/** 失敗した作成（切り抜きも 3D も同じ姿）。タイルにするための共通の形 */
interface FailedItem {
  id: string;
  name: string;
  error: string | null;
  dismiss(): void;
}

export function createModelPanel({ onPlaced }: ModelPanelOptions): { element: HTMLElement; showHome(): void } {
  const panel = document.createElement('div');
  panel.className = 'lib';

  // --- 通常の姿: 絞り込み・格子・失敗の理由 ---
  const normal = document.createElement('div');
  normal.className = 'lib__normal';

  let filter: Filter = 'all';
  const filterBar = document.createElement('div');
  filterBar.className = 'seg';
  filterBar.setAttribute('role', 'group');
  filterBar.setAttribute('aria-label', '家具の絞り込み');
  const filterButtons = new Map<Filter, HTMLButtonElement>();
  for (const [value, label] of Object.entries(FILTERS) as [Filter, string][]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'seg__item';
    button.textContent = label;
    button.addEventListener('click', () => {
      filter = value;
      render();
    });
    filterButtons.set(value, button);
    filterBar.append(button);
  }

  const grid = document.createElement('div');
  grid.className = 'tiles';

  /** 押した失敗の理由。タイルには収まらないので格子の下に出す */
  const failureDetail = document.createElement('div');
  failureDetail.className = 'lib__failure';
  failureDetail.hidden = true;
  let openFailureId: string | null = null;

  normal.append(filterBar, grid, failureDetail);

  // --- 作り方を選ぶ姿。＋ を押すと一覧と入れ替わりに出る ---
  /** 作り始めたものが絞り込みで隠れないように、「すべて」に戻す */
  function showAll(): void {
    filter = 'all';
    render();
  }

  const chooser = createChooser({
    cutout: () => void pickAndStart(),
    model: () => {
      chooser.close();
      openMaker();
    },
    onClose: () => {
      normal.hidden = false;
    },
  });

  /**
   * 一覧（ホーム）に戻した回数。高さを聞いている間に家具タブを離れたら、
   * 待っていた処理が戻ってきても画面を書き替えないために使う
   */
  let homeCount = 0;

  /** 匿名なら**写真を選ぶ前に**ログインを求める。iOS のリダイレクトは写真を持ち越せないため */
  async function pickAndStart(): Promise<void> {
    const files = await pickImages();
    if (files.length === 0) return;
    chooser.close();
    // 切り抜く前に、写真ごとの実際の高さを聞く。「‹ 戻る」なら何もせず一覧に戻る
    normal.hidden = true;
    const home = homeCount;
    const heights = await heightStep.ask(files);
    if (home !== homeCount) return;
    normal.hidden = false;
    if (!heights) return;
    void startCutout(files, heights);
    showAll();
  }

  /** 切り抜く前に実際の高さを聞く姿。作り方を選ぶ姿と入れ替わりに出る */
  const heightStep = createHeightStep();

  // --- 編集の姿 ---
  const editor = createModelEditor({
    onClose: () => {
      normal.hidden = false;
    },
    // 3D 化にもログインが要る。匿名なら追加画面のログインに送る
    onMakeModel: (model) => {
      if (authState.get().anonymous) {
        editor.close();
        openChooser();
        chooser.requireLogin('ログイン後に、もう一度「3D モデルを作成」を押してください');
        return;
      }
      void startGenerationForModel(model);
      showAll();
      editor.close();
    },
  });
  const maker = createModelMaker({
    onClose: () => {
      normal.hidden = false;
    },
    onStart: (model) => {
      if (authState.get().anonymous) {
        maker.close();
        openChooser();
        chooser.requireLogin('ログイン後に、もう一度「3D モデルを作る」を選んでください');
        return;
      }
      void startGenerationForModel(model);
      showAll();
      maker.close();
    },
    onAddFlat: () => void pickAndStartFromMaker(),
  });

  /**
   * 「3D モデルを作る」の「＋ 2D を作る」。画像を選び、高さを聞いて切り抜きを始め、
   * 3D を作る姿に戻る（切り抜き中のタイルがその場に並ぶ）。この姿へはログインしてからしか来られない
   */
  async function pickAndStartFromMaker(): Promise<void> {
    const files = await pickImages();
    if (files.length === 0) return;
    maker.element.hidden = true;
    const home = homeCount;
    const heights = await heightStep.ask(files);
    // 高さを聞いている間に家具タブを離れていたら、3D を作る姿には戻さない
    if (home !== homeCount) return;
    maker.element.hidden = false;
    if (!heights) return;
    void startCutout(files, heights);
  }

  // 家具を押したときに下から出すメニュー。「部屋に追加」（写真なら「背景に追加」）と、名前の右の鉛筆で編集
  const tileActions = createTileActions({ onPlace: placeGenerated, onEdit: openEditor });

  panel.append(normal, chooser.element, heightStep.element, maker.element, editor.element, tileActions.element);

  function openChooser(): void {
    normal.hidden = true;
    chooser.open();
  }

  /** 3D にする 2D を選ぶ姿。一覧と入れ替わりに出す */
  function openMaker(): void {
    normal.hidden = true;
    maker.open();
  }

  function openEditor(tile: ModelTile): void {
    normal.hidden = true;
    editor.open(tile.model, tile.facet);
  }

  /** 押したモデルをいまのモードの空いている場所に置く。置いた直後は選択状態にする */
  function place(item: Omit<PlacedFurniture, 'id' | 'position' | 'rotationY'>): void {
    const scene = activeScene();
    const id = crypto.randomUUID();
    onPlaced(id);
    scene.add({
      ...item,
      id,
      // 底面基準なので y = 0 が床置き。写真では、背景の物に隠れない場所を手前へ探す
      position: scene.placementFor(item.size),
      // 写真では、動かすまでは背景の物に隠さずに手前に描く（新しい家具は必ず見えるように）
      ...(scene.newInFront ? { inFront: true } : {}),
      rotationY: 0,
      // 「初期値に戻す」で戻す先。あとから大きさを変えても、ここは書き替えない
      baseSize: [...item.size],
    });
    scene.select(id);
  }

  /** 押したタイルを置く。2D のタイルからは板を、3D のタイルからはモデルを置く */
  function placeGenerated({ model, facet }: ModelTile): void {
    place({
      typeId: 'generated',
      name: model.name,
      // 商品の寸法・測ってある形・入れてもらった高さから決める（core/furnitureHeight.ts）
      size: placementSize(model, facet),
      color: PLACEHOLDER_COLOR,
      modelUrl: facet === 'solid' ? model.modelKey ?? undefined : undefined,
      imageUrl: facet === 'flat' ? model.imageKey ?? undefined : undefined,
      sourceImageKey: model.previewKey ?? undefined,
      product: model.product,
    });
  }

  /** 失敗のタイルを押した。もう一度押すと閉じる */
  function toggleFailure(id: string): void {
    openFailureId = openFailureId === id ? null : id;
    render();
  }

  function render(): void {
    const { jobs } = generationState.get();
    const { models } = modelLibrary.get();

    for (const [value, button] of filterButtons) {
      button.setAttribute('aria-pressed', String(value === filter));
    }

    // 並び: ＋、切り抜き中（数秒で終わる）、3D の作成中、失敗、できあがったものを新しい順、基本の家具。
    //
    // **タイルは作り直さず、id で使い回す。** 作成中は状態更新のたびにここが呼ばれる。
    // 毎回作り直すと画像の読み込みが一瞬遅れて、できあがったモデルの一覧が
    // ちらつく（実機で確認）。要素を保ったまま並べ替えれば画像は読み直されない
    const showFlat = filter === 'all' || filter === 'flat';
    const showSolid = filter === 'all' || filter === 'solid';
    const cutouts = cutoutState.get().jobs;
    const running = showSolid ? jobs.filter((job) => job.phase !== 'failed') : [];
    const cutting = showFlat ? cutouts.filter((job) => job.phase !== 'failed') : [];
    const failures: FailedItem[] = [
      ...(showFlat ? cutouts : [])
        .filter((job) => job.phase === 'failed')
        .map((job) => ({ id: job.id, name: job.fileName, error: job.error, dismiss: () => dismissCutoutError(job.id) })),
      ...(showSolid ? jobs : [])
        .filter((job) => job.phase === 'failed')
        .map((job) => ({ id: job.id, name: job.fileName, error: job.error, dismiss: () => dismissError(job.id) })),
    ];
    // 1 件の記録が 2D と 3D の両方を持つことがある。その場合はタイルを 2 つ並べる
    const shown: ModelTile[] = [];
    for (const model of [...models].reverse()) {
      if (showFlat && model.imageKey) shown.push({ id: `${model.id}:flat`, model, facet: 'flat' });
      if (showSolid && model.modelKey) shown.push({ id: `${model.id}:solid`, model, facet: 'solid' });
    }

    const ordered: HTMLElement[] = [];
    ordered.push(addTile);
    ordered.push(...syncThumbs(cutoutNodes, cutting, createCutoutThumb));
    ordered.push(...syncThumbs(jobNodes, running, createJobThumb));
    ordered.push(...syncThumbs(failedNodes, failures, (item) => createFailedThumb(item, toggleFailure)));
    ordered.push(...syncThumbs(modelNodes, shown, (tile) => createModelThumb(tile, tileActions.open)));
    grid.replaceChildren(...ordered);

    // 押した失敗がまだあれば理由を出す。とじる・絞り込みで見えなくなったら畳む
    const opened = failures.find((item) => item.id === openFailureId);
    failureDetail.hidden = !opened;
    if (opened) failureDetail.replaceChildren(...failureDetailContent(opened));
    for (const node of failedNodes.values()) node.element.classList.toggle('is-open', false);
    if (opened) failedNodes.get(opened.id)?.element.classList.toggle('is-open', true);
  }

  /** 表示中のタイル。切り抜き中・作成中・失敗・できあがったもので別に持つ */
  const cutoutNodes = new Map<string, ThumbNode<CutoutJob>>();
  const jobNodes = new Map<string, ThumbNode<GenerationJob>>();
  const failedNodes = new Map<string, ThumbNode<FailedItem>>();
  const modelNodes = new Map<string, ThumbNode<ModelTile>>();
  const addTile = createAddTile(openChooser);

  render();
  generationState.subscribe(render);
  cutoutState.subscribe(render);
  modelLibrary.subscribe(render);
  redirectLogin.subscribe((state) => {
    // iOS のリダイレクトから戻ってきた。写真は持ち越せていないので、選ぶ姿を開いて選び直しを促す
    if (state.outcome === 'signed-in') {
      openChooser();
      chooser.showSignedIn();
    } else if (state.outcome === 'failed') {
      openChooser();
      chooser.showSignedIn(state.error ?? 'ログインできませんでした');
    }
  });

  // 待っている間、状態そのものは変わらないので購読だけでは経過時間が止まる。
  // 3分待たせる画面で数字が動かないと、固まったように見える
  setInterval(() => {
    if (
      generationState.get().jobs.some((job) => job.phase === 'running') ||
      cutoutState.get().jobs.some((job) => job.phase !== 'failed')
    ) {
      render();
    }
  }, 1000);

  /**
   * 一覧（ホーム）に戻す。家具タブを離れたときに呼ぶ（bottomSheet.ts）。
   * 開いていた姿（家具を追加・3D モデルを作る・編集・高さの入力）はすべて閉じる。
   * 編集の保存していない変更と、高さを聞いていた写真は、「‹ 戻る」と同じく捨てる
   */
  function showHome(): void {
    homeCount += 1;
    tileActions.close();
    heightStep.cancel();
    chooser.close();
    maker.close();
    editor.close();
    normal.hidden = false;
  }

  return { element: panel, showHome };
}

/** 「＋ 作る」のタイル。格子の先頭に置く */
function createAddTile(open: () => void, caption = '追加', label = '家具を追加'): HTMLElement {
  const thumb = createThumb(caption);
  thumb.image.classList.add('is-add');
  thumb.image.append(createIcon('plus'));
  thumb.button.setAttribute('aria-label', label);
  thumb.button.addEventListener('click', open);
  return thumb.element;
}

/**
 * 作り方を選ぶ姿。＋ を押すと一覧と入れ替わりに出る。
 *
 * 匿名なら、どの行を押しても**先に**ログインを求める（写真を選ぶ前。iOS のリダイレクトは
 * 写真を持ち越せないため）。ログインできたら、商品の URL はそのまま欄を出す。写真は
 * もう一度押してもらう。ポップアップやリダイレクトを挟んだあとではブラウザが
 * 「利用者の操作」とみなさず、ファイル選択を塞ぐことがある。
 *
 * 商品の URL の欄は、その行の中（見出しの下）で開く。行と欄が離れていると、
 * どの行を押した結果かが目で追いにくい
 */
interface Chooser {
  element: HTMLElement;
  open(): void;
  close(): void;
  /** ログインの結果を伝える。何も言わないと「ログインしたのに何も起きない」に見える */
  showSignedIn(error?: string | null): void;
  /** ログインを求める。ログインできたら note を出す（別の場所から来たとき用） */
  requireLogin(note: string): void;
}

/**
 * 3D にする 2D（切り抜き）を選ぶ姿。
 *
 * 3D は 2D から作るので、**先に元の 2D を選ばせる**。すでに 3D があるものは出さない
 * （同じ家具の 3D が 2 つできてしまうため）。選ぶまで「3D モデルを作成」は押せない。
 *
 * 格子の先頭の「＋ 2D を作る」から、その場で 2D を作れる（一覧に戻らなくてよい）。
 * 切り抜き中のものも同じ格子に並べ、できあがると選べるタイルに変わる。
 * 「3D モデルを作成」は下に固定する。2D が多いと、選んだあとボタンまでスクロールが要った
 */
interface ModelMakerActions {
  onClose(): void;
  onStart(model: GeneratedModel): void;
  /** 「＋ 2D を作る」。画像を選んで切り抜きを始める */
  onAddFlat(): void;
}

function createModelMaker({ onClose, onStart, onAddFlat }: ModelMakerActions): {
  element: HTMLElement;
  open(): void;
  close(): void;
} {
  const element = document.createElement('div');
  element.className = 'lib__maker';
  element.hidden = true;

  const head = document.createElement('div');
  head.className = 'edit__head';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'button is-text is-small';
  back.textContent = '‹ 戻る';
  back.addEventListener('click', close);
  const title = document.createElement('span');
  title.className = 'edit__title';
  title.textContent = '3D モデルを作る';
  const headSpacer = document.createElement('span');
  headSpacer.className = 'edit__spacer';
  head.append(back, title, headSpacer);

  const ask = document.createElement('p');
  ask.className = 'hint';

  const grid = document.createElement('div');
  grid.className = 'tiles';
  const addTile = createAddTile(onAddFlat, '2D を作る', '2D（切り抜き）を作る');

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'button is-block';
  start.textContent = '3D モデルを作成';
  start.addEventListener('click', () => {
    const model = candidates().find((item) => item.id === selectedId);
    if (model) onStart(model);
  });

  const note = document.createElement('p');
  note.className = 'hint is-center';

  /** 選んでいる 2D。閉じるたびに忘れる（前回の選択が残っていると誤って作りやすい） */
  let selectedId: string | null = null;
  const nodes = new Map<string, ThumbNode<GeneratedModel>>();
  const cutoutNodes = new Map<string, ThumbNode<CutoutJob>>();

  // 作成ボタンと、押せない理由。スクロールしても下に残す
  const foot = document.createElement('div');
  foot.className = 'lib__maker-foot';
  foot.append(start, note);

  element.append(head, ask, grid, foot);

  /** 3D をまだ持っていない 2D。新しい順 */
  function candidates(): GeneratedModel[] {
    return [...modelLibrary.get().models]
      .reverse()
      .filter((model) => model.imageKey !== null && model.modelKey === null);
  }

  function render(): void {
    const models = candidates();
    if (selectedId !== null && !models.some((model) => model.id === selectedId)) selectedId = null;
    const cutting = cutoutState.get().jobs.filter((job) => job.phase !== 'failed');
    // 2D が 1 つも無い（切り抜き中も無い）なら、まず作ってもらう
    ask.textContent =
      models.length === 0 && cutting.length === 0
        ? '＋ から 2D（切り抜き）を作ってください。'
        : 'どの 2D（切り抜き）から作りますか？';
    grid.replaceChildren(
      addTile,
      ...syncThumbs(cutoutNodes, cutting, createCutoutThumb),
      ...syncThumbs(nodes, models, (model) =>
        createPickThumb(model, (id) => {
          selectedId = selectedId === id ? null : id;
          render();
        })
      )
    );
    for (const [id, node] of nodes) node.element.classList.toggle('is-picked', id === selectedId);

    // 回数を使い切っているなら、選んでも作れない。押せない理由をそのまま出す
    const noCredits = remainingGenerations() === 0;
    start.disabled = selectedId === null || noCredits;
    // 選べる 2D がまだ無いときは、上の文（＋ から作ってください）だけで足りるので出さない
    note.hidden = !start.disabled || (models.length === 0 && !noCredits);
    note.textContent = noCredits ? NO_CREDITS_MESSAGE : '2D（切り抜き）を選択してください';
  }

  function open(): void {
    selectedId = null;
    render();
    element.hidden = false;
  }

  function close(): void {
    element.hidden = true;
    onClose();
  }

  modelLibrary.subscribe(() => {
    if (!element.hidden) render();
  });
  walletState.subscribe(() => {
    if (!element.hidden) render();
  });
  // 切り抜き中の円を進める（切り抜きの状態が変わったときと、1 秒ごと）
  cutoutState.subscribe(() => {
    if (!element.hidden) render();
  });
  setInterval(() => {
    if (!element.hidden && cutoutState.get().jobs.some((job) => job.phase !== 'failed')) render();
  }, 1000);

  return { element, open, close };
}

/** 選ぶためのタイル。押すと選択が入れ替わる（置くのではない） */
function createPickThumb(model: GeneratedModel, pick: (id: string) => void): ThumbNode<GeneratedModel> {
  const thumb = createThumb(model.name);
  let current = model;
  const preview = createPreviewImage(thumb.image);
  const mark = document.createElement('span');
  mark.className = 'thumb__pick';
  mark.append(createIcon('check'));
  thumb.image.append(mark);
  thumb.button.addEventListener('click', () => pick(current.id));

  function update(next: GeneratedModel): void {
    current = next;
    thumb.name.textContent = next.name;
    thumb.button.setAttribute('aria-label', `${next.name} から 3D モデルを作る`);
    preview.show({ cutoutKey: next.imageKey, previewKey: next.previewKey });
  }
  update(model);
  return { element: thumb.element, update, dispose: preview.dispose };
}

function createChooser(actions: Record<Way, () => void> & { onClose(): void }): Chooser {
  const element = document.createElement('div');
  element.className = 'lib__chooser';
  element.hidden = true;

  const head = document.createElement('div');
  head.className = 'edit__head';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'button is-text is-small';
  back.textContent = '‹ 戻る';
  back.addEventListener('click', close);
  const title = document.createElement('span');
  title.className = 'edit__title';
  title.textContent = '家具を追加';
  const headSpacer = document.createElement('span');
  headSpacer.className = 'edit__spacer';
  head.append(back, title, headSpacer);

  /** 直前に押した行。ログインのあとに続きをするため */
  let pending: Way | null = null;
  /** 別の場所（編集画面の 3D 化）から来たときに、ログイン後に出す案内 */
  let afterLoginNote: string | null = null;

  const menu = document.createElement('div');
  menu.className = 'ways';
  const rows: HTMLButtonElement[] = [];
  const WAYS: { way: Way; icon: IconName; label: string; note: string }[] = [
    {
      way: 'cutout',
      icon: 'camera',
      label: '2D（切り抜き）を作る',
      note: '画像から家具を切り抜きます。背景に物が少ない画像のほうが、きれいに切り抜けます',
    },
    {
      way: 'model',
      icon: 'cube',
      label: '3D モデルを作る',
      note: '2D（切り抜き）から 3D モデルを作成します。事前に 2D（切り抜き）の作成が必要です。',
    },
  ];
  for (const { way, icon, label, note } of WAYS) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'way';
    const iconBox = document.createElement('span');
    iconBox.className = 'way__icon';
    iconBox.append(createIcon(icon));
    const text = document.createElement('span');
    text.className = 'way__text';
    const strong = document.createElement('span');
    strong.className = 'way__label';
    strong.textContent = label;
    const small = document.createElement('span');
    small.className = 'way__note';
    small.textContent = note;
    text.append(strong, small);
    row.append(iconBox, text);
    row.addEventListener('click', () => {
      signedInNote.hidden = true;
      if (authState.get().anonymous) {
        pending = way;
        loginPanel.open();
        renderState();
        return;
      }
      actions[way]();
    });
    rows.push(row);
    menu.append(row);
  }

  /** 押す前から、ログインが要ることが分かるようにしておく。匿名のときだけ出す */
  const loginHint = document.createElement('p');
  loginHint.className = 'hint lib__login-hint';
  loginHint.textContent = '家具を作るには Google ログインが必要です';
  /** 認証できないときだけ出す。押せない理由が無いと、壊れているように見える */
  const authNote = document.createElement('p');
  authNote.className = 'hint is-error';
  authNote.hidden = true;
  const signedInNote = document.createElement('p');
  signedInNote.className = 'hint';
  signedInNote.hidden = true;

  // ログインを求めるパネル。行と入れ替わりで出る
  const loginPanel = createLoginPanel(() => {
    // ポップアップでログインできた直後。3D を作るはそのまま続けられる。
    // 2D はファイル選択を開けないので、もう一度押してもらう
    if (pending === 'model') actions.model();
    else if (afterLoginNote) showSignedIn(null, afterLoginNote);
    else showSignedIn();
    pending = null;
    afterLoginNote = null;
  });

  element.append(head, menu, loginPanel.element, loginHint, authNote, signedInNote);

  function showSignedIn(error: string | null = null, note?: string): void {
    signedInNote.classList.toggle('is-error', error !== null);
    signedInNote.textContent =
      error ?? note ?? 'ログインしました。もう一度「2D（切り抜き）を作る」を押して画像を選んでください';
    signedInNote.hidden = false;
  }

  function requireLogin(note: string): void {
    afterLoginNote = note;
    loginPanel.open();
    renderState();
  }

  function renderState(): void {
    const { status, anonymous } = authState.get();
    // 認証できないとこのあと何をしても失敗する。黙って止まると原因が分からないので出す
    const authFailed = status === 'failed';
    for (const row of rows) row.disabled = authFailed;
    authNote.hidden = !authFailed;
    authNote.textContent = authFailed ? authFailureMessage() : '';
    loginHint.hidden = authFailed || !anonymous;
    // ログインを求めている間は行を引っ込める（同じ場所に出す）
    menu.hidden = !loginPanel.element.hidden;
  }

  function open(): void {
    signedInNote.hidden = true;
    pending = null;
    afterLoginNote = null;
    loginPanel.close();
    renderState();
    element.hidden = false;
  }

  function close(): void {
    element.hidden = true;
    actions.onClose();
  }

  authState.subscribe(renderState);
  // パネルの出し入れは hidden 属性の変化なので、状態の購読では拾えない
  new MutationObserver(renderState).observe(loginPanel.element, { attributeFilter: ['hidden'] });
  renderState();

  return { element, open, close, showSignedIn, requireLogin };
}

/** できあがったモデル。押すと置く。× で保管庫から外す */
/** 使い回すサムネイル。update で変わった部分だけ描き直し、dispose で画像の URL を解放する */
interface ThumbNode<T> {
  element: HTMLElement;
  update(item: T): void;
  dispose(): void;
}

/**
 * id で使い回しながら、並び順どおりの要素を返す。無くなったものは捨てる。
 * 作り直さないのは、作成中の状態更新のたびに画像が読み直されてちらつくため
 */
function syncThumbs<T extends { id: string }>(
  nodes: Map<string, ThumbNode<T>>,
  items: T[],
  create: (item: T) => ThumbNode<T>
): HTMLElement[] {
  const wanted = new Set<string>();
  const ordered: HTMLElement[] = [];
  for (const item of items) {
    wanted.add(item.id);
    let node = nodes.get(item.id);
    if (!node) {
      node = create(item);
      nodes.set(item.id, node);
    }
    node.update(item);
    ordered.push(node.element);
  }
  for (const [id, node] of nodes) {
    if (!wanted.has(id)) {
      node.dispose();
      nodes.delete(id);
    }
  }
  return ordered;
}

/**
 * 家具のタイルを押したときに、画面の下から出すメニュー。家具の画像と名前、［✎ 編集］と［部屋に追加］を出す。
 * よく使う「追加」を大きく、「編集」を控えめにして並べる。前は名前の右の鉛筆だけで、文字が無く、編集だと気づきにくかった。
 * 置く先の呼び名は、画面右上の切り替え（部屋 / 背景）に合わせる（写真のときは「背景に追加」）。
 *
 * **押しただけでは置かない。** 前は押すとすぐ置き、編集は右上の小さな「⋯」からだった。
 * 小さな印は狙いにくく、編集したいのに置いてしまうことがあった。下に大きなボタンを並べれば、親指で選べる。
 * 外側（暗くした所）を押すと閉じる
 */
function createTileActions(actions: { onPlace(tile: ModelTile): void; onEdit(tile: ModelTile): void }): {
  element: HTMLElement;
  open(tile: ModelTile): void;
  close(): void;
} {
  const element = document.createElement('div');
  element.className = 'tile-actions';
  element.hidden = true;

  const dim = document.createElement('div');
  dim.className = 'tile-actions__dim';

  const sheet = document.createElement('div');
  sheet.className = 'tile-actions__sheet';
  sheet.setAttribute('role', 'dialog');

  const head = document.createElement('div');
  head.className = 'tile-actions__head';
  const image = document.createElement('span');
  image.className = 'tile-actions__img';
  const preview = createPreviewImage(image);
  const text = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'tile-actions__name';
  const kind = document.createElement('div');
  kind.className = 'tile-actions__kind';
  text.append(name, kind);
  head.append(image, text);

  // 下の段: 控えめな［✎ 編集］と、大きな［部屋に追加］（写真のときは［背景に追加］）
  const buttons = document.createElement('div');
  buttons.className = 'tile-actions__buttons';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'tile-actions__edit';
  const editLabel = document.createElement('span');
  editLabel.textContent = '編集';
  edit.append(createPencilIcon(), editLabel);
  const place = document.createElement('button');
  place.type = 'button';
  place.className = 'button tile-actions__button';
  buttons.append(edit, place);

  sheet.append(head, buttons);
  element.append(dim, sheet);

  let current: ModelTile | null = null;
  function close(): void {
    element.hidden = true;
    current = null;
  }
  /** 閉じてから選んだことをする（置く・編集を開く）。先に閉じないと、編集の姿の上にメニューが残る */
  function choose(action: (tile: ModelTile) => void): void {
    const tile = current;
    close();
    if (tile) action(tile);
  }
  dim.addEventListener('click', close);
  place.addEventListener('click', () => choose(actions.onPlace));
  edit.addEventListener('click', () => choose(actions.onEdit));

  return {
    element,
    open(tile) {
      current = tile;
      name.textContent = tile.model.name;
      kind.textContent = facetLabel(tile.facet);
      // 開くたびに、いまの置き先の呼び名にする
      place.textContent = isPhotoMode() ? '背景に追加' : '部屋に追加';
      sheet.setAttribute('aria-label', `${tile.model.name} の${facetLabel(tile.facet)}`);
      preview.show({ cutoutKey: tile.model.imageKey, previewKey: tile.model.previewKey });
      element.hidden = false;
    },
    close,
  };
}

/** タイルの種類の呼び名。メニューと読み上げで使う */
function facetLabel(facet: ModelFacet): string {
  return facet === 'solid' ? '3D モデル' : '2D（切り抜き）';
}

/** 鉛筆の記号（編集）。線の太さと端の丸みを、ほかの線のアイコンにそろえる */
function createPencilIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M4 20h4L19 9l-4-4L4 16z');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

/** 家具のタイル。押すと「部屋に追加」（または「背景に追加」）と編集のメニューを開く（置くのはメニューから） */
function createModelThumb(tile: ModelTile, open: (tile: ModelTile) => void): ThumbNode<ModelTile> {
  const thumb = createThumb(tile.model.name);
  let current = tile;
  thumb.button.addEventListener('click', () => open(current));
  const preview = createPreviewImage(thumb.image);
  // アイコンは 2D と 3D で同じものを使うので、左上の印だけが見分けになる
  thumb.image.append(createTag(tile.facet === 'solid' ? '3D' : '2D'));

  function update(next: ModelTile): void {
    current = next;
    thumb.name.textContent = next.model.name;
    thumb.button.setAttribute('aria-label', `${next.model.name} の${facetLabel(next.facet)}`);
    preview.show({ cutoutKey: next.model.imageKey, previewKey: next.model.previewKey });
  }
  update(tile);
  return { element: thumb.element, update, dispose: preview.dispose };
}

/**
 * 作った家具の編集の姿。名前とサイズを変え、削除もここから。いちばん上にアイコンを出す。
 *
 * **2D と 3D は別々に開く。** 開いている面だけが消せる（2D を消しても 3D は残る）ので、
 * 見出しも削除の文言も、いまどちらを触っているかを名指しする。
 *
 * 削除は「この…を完全に削除」→ 確認 → 「削除する」の二段階。確認にはアイコンも出し、
 * 同じ名前の家具があっても取り違えないようにする。
 * 一覧から外すだけで、置いてある家具はそのまま残る（removeModelFacet の挙動）
 */
interface ModelEditorActions {
  onClose(): void;
  /** 切り抜き（2D）の家具から 3D を作る */
  onMakeModel(model: GeneratedModel): void;
}

/** 面ごとの呼び名。見出し・ボタン・確認で同じ言い方を使う */
const FACET_NAME: Record<ModelFacet, string> = { flat: '2D（切り抜き）', solid: '3D モデル' };

function createModelEditor({ onClose, onMakeModel }: ModelEditorActions): {
  element: HTMLElement;
  open(model: GeneratedModel, facet: ModelFacet): void;
  close(): void;
} {
  const element = document.createElement('div');
  element.className = 'lib__edit';
  element.hidden = true;
  let current: GeneratedModel | null = null;
  /** いま開いている面。削除の対象もこれ */
  let facet: ModelFacet = 'flat';

  const head = document.createElement('div');
  head.className = 'edit__head';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'button is-text is-small';
  back.textContent = '‹ 戻る';
  back.addEventListener('click', close);
  const title = document.createElement('span');
  title.className = 'edit__title';
  const headSpacer = document.createElement('span');
  headSpacer.className = 'edit__spacer';
  head.append(back, title, headSpacer);

  // アイコン。ほかの欄と同じく、見出しの下に画像を出す（切り抜きがあればそれ。previewImage.ts）
  const iconField = document.createElement('div');
  iconField.className = 'field';
  const iconLabel = document.createElement('span');
  iconLabel.className = 'field__label';
  iconLabel.textContent = 'アイコン';
  const icon = document.createElement('span');
  icon.className = 'thumb__img edit__icon';
  const iconPreview = createPreviewImage(icon);
  iconField.append(iconLabel, icon);

  const nameField = document.createElement('div');
  nameField.className = 'field';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'field__label';
  nameLabel.textContent = '名前';
  nameLabel.htmlFor = 'model-editor-name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = 'model-editor-name';
  nameInput.className = 'field__input';
  nameInput.maxLength = 40;
  nameField.append(nameLabel, nameInput);

  // サイズ。幅・奥行き・高さのどれかを変えると、比率を保って全体が変わる。
  // 保存すると、置いてある同じ家具もこのサイズにそろう（core/furnitureHeight.ts）
  const sizeField = createSizeField();

  // 商品ページから取り込んだ家具なら、店名・寸法と「楽天で見る」を出す
  const productField = document.createElement('div');
  productField.className = 'field';
  const productLabel = document.createElement('span');
  productLabel.className = 'field__label';
  productLabel.textContent = '商品';
  const productNote = document.createElement('p');
  productNote.className = 'hint';
  const productLinkSlot = document.createElement('div');
  productField.append(productLabel, productNote, productLinkSlot);

  // 2D を開いているときだけ出す。3D にすると向きを変えて置ける
  const modelField = document.createElement('div');
  modelField.className = 'edit__make';
  const makeModel = document.createElement('button');
  makeModel.type = 'button';
  makeModel.className = 'button is-block';
  makeModel.textContent = '3D モデルを作成';
  makeModel.addEventListener('click', () => {
    if (current) onMakeModel(current);
  });
  const modelNote = document.createElement('p');
  modelNote.className = 'hint is-center';
  modelField.append(makeModel, modelNote);

  const actions = document.createElement('div');
  actions.className = 'edit__actions';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'button is-small';
  save.textContent = '保存';
  save.addEventListener('click', () => {
    if (!current) return;
    const name = nameInput.value.trim();
    if (name && name !== current.name) {
      updateModel(current.id, { name });
      renamePlacedCopies(current, name);
    }
    // 空や数でないものは変えない（消して保存しても、前のサイズのまま）。比率は保つので、高さで決まる
    const size = sizeField.value();
    if (size && Math.abs(size[1] - shownHeight(current)) > 1e-6) setModelHeight(current.id, size[1]);
    close();
  });
  actions.append(save);

  const divider = document.createElement('div');
  divider.className = 'divider';

  // 取り消せない操作なので、作成の青いボタンから縦に離す。
  // 塗りつぶしも枠も付けず文字だけにして、誤って押す圧を下げる
  const spacer = document.createElement('div');
  spacer.className = 'edit__spacer-fill';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'button is-text is-danger-text is-block';
  remove.addEventListener('click', () => {
    modal.hidden = false;
  });

  // 確認は画面全体を覆って出す。背後の画面を触れなくして、答えるまで進ませない
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.hidden = true;
  const modalBox = document.createElement('div');
  modalBox.className = 'modal__box';
  modalBox.setAttribute('role', 'dialog');
  modalBox.setAttribute('aria-modal', 'true');
  const confirmTitle = document.createElement('b');
  confirmTitle.className = 'modal__title';
  const confirmRow = document.createElement('div');
  confirmRow.className = 'confirm__what';
  const confirmIcon = document.createElement('span');
  confirmIcon.className = 'thumb__img confirm__icon';
  const confirmIconPreview = createPreviewImage(confirmIcon);
  const confirmText = document.createElement('span');
  confirmRow.append(confirmIcon, confirmText);
  const confirmNote = document.createElement('p');
  confirmNote.className = 'hint is-error';
  confirmNote.textContent = 'この端末から完全に削除します。削除後は復元はできませんがよろしいですか？';
  const confirmButtons = document.createElement('div');
  confirmButtons.className = 'confirm__buttons';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'button is-quiet is-small';
  cancel.textContent = 'やめる';
  cancel.addEventListener('click', () => {
    modal.hidden = true;
  });
  const doRemove = document.createElement('button');
  doRemove.type = 'button';
  doRemove.className = 'button is-danger is-small';
  doRemove.textContent = '削除する';
  doRemove.addEventListener('click', () => {
    if (!current) return;
    removeModelFacet(current.id, facet);
    close();
  });
  confirmButtons.append(cancel, doRemove);
  modalBox.append(confirmTitle, confirmRow, confirmNote, confirmButtons);
  modal.append(modalBox);

  element.append(head, iconField, nameField, sizeField.element, productField, actions, modelField, spacer, divider, remove, modal);

  /** 欄に出す高さ（m）。入れてあればそれ、無ければ置くときの高さ */
  function shownHeight(model: GeneratedModel): number {
    return model.height ?? placementSize(model, facet)[1];
  }

  /**
   * 3D の段の案内と押せるか。作っている最中と、回数を使い切ったときは押せない。
   * 残りの回数は財布の写し（core/wallet.ts）から出す。写しが無ければ回数には触れない
   */
  function renderModelField(): void {
    const model = current;
    if (!model) return;
    const making = generationState.get().jobs.some((job) => job.targetModelId === model.id && job.phase !== 'failed');
    const noCredits = remainingGenerations() === 0;
    makeModel.disabled = making || noCredits;
    modelNote.textContent = making
      ? '3D モデルを作っています。一覧の作成中のタイルで進み具合が見られます'
      : noCredits
        ? NO_CREDITS_MESSAGE
        : `2D（切り抜き）から 3D モデルを作ります。${remainingNote()}`;
  }

  /** 「。お試しはあと 2 回です」のような添え書き。匿名なら、ログインすると使えることを伝える */
  function remainingNote(): string {
    if (authState.get().anonymous) return 'Google でログインすると、お試しで 3 回まで作れます';
    const { status, trialRemaining, credits } = walletState.get();
    if (status !== 'ready') return '';
    if (trialRemaining > 0) return `お試しはあと ${trialRemaining} 回です`;
    return `残り ${credits} 回です`;
  }

  // 開いている間に残高やログインの状態が変わったら（作成を頼んだ直後など）、案内を追いかける
  walletState.subscribe(() => {
    if (!element.hidden) renderModelField();
  });
  generationState.subscribe(() => {
    if (!element.hidden) renderModelField();
  });

  function open(model: GeneratedModel, openedFacet: ModelFacet): void {
    current = model;
    facet = openedFacet;
    const kind = FACET_NAME[facet];
    title.textContent = `${kind}の編集`;
    nameInput.value = model.name;
    sizeField.show(placementSize(model, facet), facet === 'flat');
    iconPreview.show({ cutoutKey: model.imageKey, previewKey: model.previewKey });
    confirmIconPreview.show({ cutoutKey: model.imageKey, previewKey: model.previewKey });
    confirmTitle.textContent = `この ${kind}を削除します`;
    confirmText.textContent = model.name;
    remove.textContent = `この ${kind}を完全に削除`;
    // 3D 化は 2D を開いているときだけ。すでに 3D があるなら出さない
    modelField.hidden = facet !== 'flat' || model.modelKey !== null;
    renderModelField();
    productField.hidden = !model.product;
    if (model.product) {
      // 寸法はサイズの欄に出ているので、ここでは店名だけ。取れなかったときは入れてもらう
      productNote.textContent = model.size
        ? model.product.shop
        : `${model.product.shop}・商品ページから寸法を取得できなかったため、サイズを入力してください`;
      productLinkSlot.replaceChildren(createProductLink(model.product));
    }
    modal.hidden = true;
    element.hidden = false;
  }

  function close(): void {
    current = null;
    element.hidden = true;
    onClose();
  }

  return { element, open, close };
}

/**
 * 切り抜き中の家具。円はサーバーの工程と見込み秒数で進む（core/cutout.ts の cutoutProgress）。
 * 1 行目が届くまでは「起動を待っています」で、コールドスタートを嘘の円で隠さない
 */
function createCutoutThumb(job: CutoutJob): ThumbNode<CutoutJob> {
  const thumb = createThumb(cutoutProgress(job).label);
  thumb.button.disabled = true;
  thumb.image.classList.add('is-running');
  const ring = createProgressRing();
  thumb.image.append(ring.element);

  function update(current: CutoutJob): void {
    if (current.previewUrl) thumb.image.style.backgroundImage = `url("${current.previewUrl}")`;
    const progress = cutoutProgress(current);
    thumb.name.textContent = current.phase === 'failed' ? '失敗しました' : progress.label;
    ring.update(progress.ratio, '');
  }
  update(job);
  // 元写真の Blob URL は切り抜きの状態が持っているので、ここでは解放しない
  return { element: thumb.element, update, dispose() {} };
}

/** 作成中の 3D モデル。円で進み具合を出す。まだ押しても何も起きない */
function createJobThumb(job: GenerationJob): ThumbNode<GenerationJob> {
  const thumb = createThumb(describe(job));
  thumb.button.disabled = true;
  thumb.image.classList.add('is-running');
  if (job.previewUrl) thumb.image.style.backgroundImage = `url("${job.previewUrl}")`;

  // 円は小さく出すので中に文字は入れない。残り時間は下の名前の場所に出す。
  // 実行が始まるまでは残り時間が読めないので、円は空のまま
  const ring = createProgressRing();
  thumb.image.append(ring.element, createTag('3D'));

  function update(current: GenerationJob): void {
    thumb.name.textContent = describe(current);
    ring.update(
      current.phase === 'running'
        ? progressFor(current.serverPhase, elapsedInPhase(current), current.engine).ratio
        : 0,
      ''
    );
  }
  update(job);
  // 元写真の Blob URL は作成の状態が持っているので、ここでは解放しない
  return { element: thumb.element, update, dispose() {} };
}

/** 画像の隅に付ける小さな印（「3D」）。読み上げは名前に含めないので aria-hidden */
function createTag(text: string): HTMLElement {
  const tag = document.createElement('span');
  tag.className = 'thumb__tag';
  tag.textContent = text;
  tag.setAttribute('aria-hidden', 'true');
  return tag;
}

/** サムネイルの骨組み。画像の枠と、その下の名前 */
function createThumb(caption: string): {
  element: HTMLElement;
  button: HTMLButtonElement;
  image: HTMLElement;
  name: HTMLElement;
} {
  const element = document.createElement('div');
  element.className = 'thumb';
  const button = document.createElement('button');
  button.className = 'thumb__button';
  const image = document.createElement('span');
  image.className = 'thumb__img';
  const name = document.createElement('span');
  name.className = 'thumb__name';
  name.textContent = caption;
  button.append(image, name);
  element.append(button);
  return { element, button, image, name };
}

/**
 * 失敗した作成のタイル。「!」の印と「作れませんでした」。
 * 理由はタイルに収まらないので、押すと格子の下に出る（failureDetailContent）
 */
function createFailedThumb(item: FailedItem, toggle: (id: string) => void): ThumbNode<FailedItem> {
  const thumb = createThumb('失敗しました');
  thumb.image.classList.add('is-failed');
  const badge = document.createElement('span');
  badge.className = 'thumb__badge';
  badge.textContent = '!';
  thumb.image.append(badge);
  thumb.button.setAttribute('aria-label', `${item.name}: 失敗しました。理由を見る`);
  thumb.button.addEventListener('click', () => toggle(item.id));
  return { element: thumb.element, update() {}, dispose() {} };
}

/** 失敗の理由と「とじる」。とじると、その失敗だけが消える */
function failureDetailContent(item: FailedItem): HTMLElement[] {
  const message = document.createElement('p');
  message.className = 'hint is-error';
  message.textContent = `${item.name}: ${item.error ?? '作れませんでした'}`;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'button is-quiet is-small';
  closeButton.textContent = 'とじる';
  closeButton.addEventListener('click', item.dismiss);
  return [message, closeButton];
}

/**
 * 認証できなかった理由。
 *
 * 設定の入れ忘れと、通信や鍵の問題は、利用者がすべきことが違う。
 * 前者は開き直しても直らないので、そう伝える
 */
function authFailureMessage(): string {
  return IS_CONFIGURED
    ? '認証できませんでした。通信状況を確認して、アプリを開き直してください'
    : 'このアプリには家具を作る設定がありません。管理者にお知らせください';
}

/** サムネイルの下に出す短い状態。幅 72px に収まる長さにする */
function describe(job: GenerationJob): string {
  switch (job.phase) {
    case 'uploading':
      return '送信中';
    case 'queued':
      return '順番待ち';
    case 'running':
      // 「あと5分」「まもなく」。見込みであって約束ではない（core/progress.ts）
      return progressFor(job.serverPhase, elapsedInPhase(job), job.engine).centerText;
    case 'saving':
      return '保存中';
    case 'failed':
      return '作れませんでした';
  }
}

/**
 * いまの工程に入ってから何秒経ったか。
 *
 * 基準はサーバーが返した経過秒を端末の時刻に直したもの（generation.ts が持つ）。
 * まだ工程が分かっていないうちは、実行が始まった時刻からの経過で代用する
 */
function elapsedInPhase(job: GenerationJob): number {
  const base = job.serverPhaseStartedAt ?? job.startedRunningAt;
  if (!base) return 0;
  return Math.max(0, Math.floor((Date.now() - base) / 1000));
}
