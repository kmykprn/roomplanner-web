/**
 * 「家具」タブ。置ける家具をタイルの格子に並べ、押すといまのモード（部屋／写真）に置く。
 *
 *   格子の先頭 … 「＋ 追加」。押すと一覧と入れ替わりに「家具を追加」の姿が出る。
 *                入口は 2 つで、2D（切り抜き）を作る（数秒）／3D モデルを作る（数分）。
 *                匿名ならその姿の中でログインを求める（ui/loginPanel.ts）。
 *                3D は 2D から作るので、作る前に元の 2D を選ばせる
 *   続き       … 作った家具。作成中はその場で円が進み、できあがると押せる姿になる。
 *                失敗は「!」のタイルで、押すと格子の下に理由と「とじる」が出る。
 *                右上の「⋯」で編集の姿（名前・アイコン・削除）に切り替わる。
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
import { activeScene } from '@/core/mode';
import { currentEngine, ENGINES, setEngine, type Engine } from '@/core/engine';
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
  GENERATED_SIZE,
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
import { pickImage, pickImages } from '@/platform/picker';
import { savePreview } from '@/platform/previewCache';
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

export function createModelPanel({ onPlaced }: ModelPanelOptions): HTMLElement {
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
    cutout: () => void pickAndStart(startCutout),
    model: () => {
      chooser.close();
      openMaker();
    },
    onClose: () => {
      normal.hidden = false;
    },
  });

  /** 匿名なら**写真を選ぶ前に**ログインを求める。iOS のリダイレクトは写真を持ち越せないため */
  async function pickAndStart(start: (files: File[]) => Promise<void>): Promise<void> {
    const files = await pickImages();
    if (files.length === 0) return;
    void start(files);
    showAll();
    chooser.close();
  }

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
  });

  panel.append(normal, chooser.element, maker.element, editor.element);

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
      // 底面基準なので y = 0 が床置き。既存の家具に埋まらない場所を選ぶ
      position: scene.placementFor(item.size),
      rotationY: 0,
    });
    scene.select(id);
  }

  /** 押したタイルを置く。2D のタイルからは板を、3D のタイルからはモデルを置く */
  function placeGenerated({ model, facet }: ModelTile): void {
    place({
      typeId: 'generated',
      name: model.name,
      // 商品ページから寸法が取れていれば実寸。無ければいちばん長い辺 1m
      size: model.size ? [...model.size] : [...GENERATED_SIZE],
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
    ordered.push(...syncThumbs(modelNodes, shown, (tile) => createModelThumb(tile, placeGenerated, openEditor)));
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

  return panel;
}

/** 「＋ 作る」のタイル。格子の先頭に置く */
function createAddTile(open: () => void): HTMLElement {
  const thumb = createThumb('追加');
  thumb.image.classList.add('is-add');
  thumb.image.append(createIcon('plus'));
  thumb.button.setAttribute('aria-label', '家具を追加');
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
 */
interface ModelMakerActions {
  onClose(): void;
  onStart(model: GeneratedModel): void;
}

function createModelMaker({ onClose, onStart }: ModelMakerActions): {
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
  ask.textContent = 'どの 2D（切り抜き）から作りますか？';

  const grid = document.createElement('div');
  grid.className = 'tiles';

  const divider = document.createElement('div');
  divider.className = 'divider';

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

  element.append(head, ask, grid, divider, createEngineChoice(), start, note);

  /** 3D をまだ持っていない 2D。新しい順 */
  function candidates(): GeneratedModel[] {
    return [...modelLibrary.get().models]
      .reverse()
      .filter((model) => model.imageKey !== null && model.modelKey === null);
  }

  function render(): void {
    const models = candidates();
    if (selectedId !== null && !models.some((model) => model.id === selectedId)) selectedId = null;
    grid.replaceChildren(
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
    note.hidden = !start.disabled;
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
    preview.show(next.previewKey);
  }
  update(model);
  return { element: thumb.element, update, dispose: preview.dispose };
}

/**
 * 3D の作り方の切り替え。
 *
 * 選んだ結果は端末に残る（`src/core/engine.ts`）。既定は速いほう（TRELLIS）。
 * 作成中のものには影響しない（依頼した時点の作り方で進み具合を出す）
 */
function createEngineChoice(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'engine';

  const label = document.createElement('span');
  label.className = 'engine__label';
  label.id = 'engine-label';
  label.textContent = '3D の作り方';

  const bar = document.createElement('div');
  bar.className = 'seg';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-labelledby', label.id);

  const buttons = new Map<Engine, HTMLButtonElement>();
  for (const { value, label: text, note } of ENGINES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `engine-${value}`;
    button.className = 'seg__item';
    button.textContent = text;
    button.title = note;
    button.addEventListener('click', () => {
      setEngine(value);
      renderChoice();
    });
    buttons.set(value, button);
    bar.append(button);
  }

  const note = document.createElement('p');
  note.className = 'hint engine__note';

  function renderChoice(): void {
    const engine = currentEngine();
    for (const [value, button] of buttons) {
      const active = value === engine;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    note.textContent =
      engine === 'trellis'
        ? '約 2 分でできます。裏側が暗くなることがあります'
        : '約 8 分かかります。裏側まで作ります';
  }

  renderChoice();
  wrap.append(label, bar, note);
  return wrap;
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

  element.append(head, menu, loginPanel.element, loginHint, authNote, signedInNote, createIdentity());

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

function createModelThumb(
  tile: ModelTile,
  place: (tile: ModelTile) => void,
  edit: (tile: ModelTile) => void
): ThumbNode<ModelTile> {
  const thumb = createThumb(tile.model.name);
  let current = tile;
  thumb.button.addEventListener('click', () => place(current));
  const preview = createPreviewImage(thumb.image);
  // アイコンは 2D と 3D で同じものを使うので、左上の印だけが見分けになる
  thumb.image.append(createTag(tile.facet === 'solid' ? '3D' : '2D'));

  // 右上の「⋯」で編集へ。押しても置いてしまわないよう、下のボタンには渡さない
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'thumb__more';
  more.textContent = '⋯';
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    edit(current);
  });
  thumb.image.append(more);

  function update(next: ModelTile): void {
    current = next;
    const kind = next.facet === 'solid' ? '3D モデル' : '2D（切り抜き）';
    thumb.name.textContent = next.model.name;
    thumb.button.setAttribute('aria-label', `${next.model.name} の${kind}を置く`);
    more.setAttribute('aria-label', `${next.model.name} の${kind}を編集`);
    preview.show(next.model.previewKey);
  }
  update(tile);
  return { element: thumb.element, update, dispose: preview.dispose };
}

/**
 * 作った家具の編集の姿。名前とアイコンを変え、削除もここから。
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

  const iconRow = document.createElement('div');
  iconRow.className = 'edit__row';
  const icon = document.createElement('span');
  icon.className = 'thumb__img edit__icon';
  const iconPreview = createPreviewImage(icon);
  const iconField = document.createElement('div');
  iconField.className = 'field';
  const iconLabel = document.createElement('span');
  iconLabel.className = 'field__label';
  iconLabel.textContent = 'アイコン';
  const iconButton = document.createElement('button');
  iconButton.type = 'button';
  iconButton.className = 'button is-quiet is-small';
  iconButton.textContent = 'アイコンを変更';
  iconButton.addEventListener('click', async () => {
    if (!current) return;
    const file = await pickImage();
    if (!file) return;
    // 新しいキーで保存する。同じキーに上書きすると、置いてある家具が見ている前の画像まで変わる
    const saved = await savePreview(crypto.randomUUID(), file);
    if (!saved) return;
    URL.revokeObjectURL(saved.url);
    updateModel(current.id, { previewKey: saved.key });
    current = { ...current, previewKey: saved.key };
    iconPreview.show(saved.key);
  });
  iconField.append(iconLabel, iconButton);
  iconRow.append(icon, iconField);

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

  element.append(head, iconRow, nameField, productField, actions, modelField, spacer, divider, remove, modal);

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
    iconPreview.show(model.previewKey);
    confirmIconPreview.show(model.previewKey);
    confirmTitle.textContent = `この ${kind}を削除します`;
    confirmText.textContent = model.name;
    remove.textContent = `この ${kind}を完全に削除`;
    // 3D 化は 2D を開いているときだけ。すでに 3D があるなら出さない
    modelField.hidden = facet !== 'flat' || model.modelKey !== null;
    renderModelField();
    productField.hidden = !model.product;
    if (model.product) {
      productNote.textContent = model.size
        ? `${model.product.shop}・幅 ${(model.size[0] * 100).toFixed(0)} × 奥行 ${(model.size[2] * 100).toFixed(0)} × 高さ ${(model.size[1] * 100).toFixed(0)} cm`
        : `${model.product.shop}・寸法を取得できませんでした。「操作」タブで大きさを調整してください`;
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
 * 利用者ID。限定公開のうちは、この識別子をサーバー側の許可リストに登録してもらう
 * 必要がある。個人情報は含まれない（uid は無作為な文字列で、Google に紐づけても変わらない）。
 * 全員が使えるようになったら、この表示ごと消してよい
 */
function createIdentity(): HTMLElement {
  const identity = document.createElement('details');
  identity.className = 'identity';
  const summary = document.createElement('summary');
  summary.textContent = '利用者 ID';
  const uidText = document.createElement('code');
  identity.append(summary, uidText);
  const render = (): void => {
    const { status, uid } = authState.get();
    uidText.textContent = status === 'failed' ? '取得できませんでした' : (uid ?? '取得中…');
  };
  render();
  authState.subscribe(render);
  return identity;
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
