/**
 * 「家具」タブ。置ける家具をタイルの格子に並べ、押すといまのモード（部屋／写真）に置く。
 *
 *   格子の先頭 … 「＋ 作る」。押すと一覧と入れ替わりに「作り方を選ぶ」姿が出る。
 *                写真から切り抜く（数秒）／商品ページの URL から（実寸で置ける）／
 *                3D モデルとして（約 3 分）。匿名ならその姿の中でログインを求める（ui/loginPanel.ts）
 *   続き       … 作った家具。作成中はその場で円が進み、できあがると押せる姿になる。
 *                失敗は「!」のタイルで、押すと格子の下に理由と「とじる」が出る。
 *                右上の「⋯」で編集の姿（名前・アイコン・削除）に切り替わる。
 *   その後     … 基本の家具（椅子・テーブル…）。色の四角のタイル
 *
 * 格子の上の「すべて / 2D / 3D / 基本」で絞れる。2D は切り抜きの板、3D は向きを変えられるモデル。
 *
 * 3D 生成は約 3 分かかるので、**待たせる画面ではなく、待たせない画面**にする。
 * ここは進み具合を映すだけで、進行そのものは core/generation.ts と core/cutout.ts が持っている。
 */

import { FURNITURE_TYPES, type FurnitureType, type PlacedFurniture } from '@/config/furniture';
import { IS_CONFIGURED } from '@/config/api';
import { activeScene } from '@/core/mode';
import { progressFor } from '@/core/progress';
import {
  dismissError,
  generationState,
  startGeneration,
  type GenerationJob,
} from '@/core/generation';
import {
  cutoutProgress,
  cutoutState,
  dismissCutoutError,
  startCutout,
  startProductImport,
  type CutoutJob,
} from '@/core/cutout';
import { createProductForm } from '@/ui/productForm';
import { createProductLink } from '@/ui/productLink';
import {
  GENERATED_SIZE,
  PLACEHOLDER_COLOR,
  modelLibrary,
  removeModel,
  renamePlacedCopies,
  updateModel,
  type GeneratedModel,
} from '@/core/modelLibrary';
import { authState, redirectLogin } from '@/platform/auth';
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
type Filter = 'all' | 'flat' | 'solid' | 'basic';
const FILTERS: Record<Filter, string> = { all: 'すべて', flat: '2D', solid: '3D', basic: '基本' };

/** 作り方。「作り方を選ぶ」姿の 3 行 */
type Way = 'photo' | 'product' | 'model';

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
  const chooser = createChooser({
    photo: () => void pickAndStart(startCutout),
    model: () => void pickAndStart(startGeneration),
    product: () => productForm.open(),
    onClose: () => {
      normal.hidden = false;
    },
  });
  const productForm = createProductForm({
    onSubmit: (url) => {
      void startProductImport(url);
      chooser.close();
    },
    onToggle: (opened) => chooser.markProductOpen(opened),
  });
  // 欄は「商品の URL から」の行の中で開く（行の見出しの下）。別の囲みにしない
  chooser.productSlot.append(productForm.element);

  /** 匿名なら**写真を選ぶ前に**ログインを求める。iOS のリダイレクトは写真を持ち越せないため */
  async function pickAndStart(start: (files: File[]) => Promise<void>): Promise<void> {
    const files = await pickImages();
    if (files.length === 0) return;
    void start(files);
    chooser.close();
  }

  // --- 編集の姿 ---
  const editor = createModelEditor(() => {
    normal.hidden = false;
  });
  panel.append(normal, chooser.element, editor.element);

  function openChooser(): void {
    normal.hidden = true;
    productForm.close();
    chooser.open();
  }

  function openEditor(model: GeneratedModel): void {
    normal.hidden = true;
    editor.open(model);
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

  function placeGenerated(model: GeneratedModel): void {
    place({
      typeId: 'generated',
      name: model.name,
      // 商品ページから寸法が取れていれば実寸。無ければいちばん長い辺 1m
      size: model.size ? [...model.size] : [...GENERATED_SIZE],
      color: PLACEHOLDER_COLOR,
      modelUrl: model.modelKey ?? undefined,
      imageUrl: model.imageKey ?? undefined,
      sourceImageKey: model.previewKey ?? undefined,
      product: model.product,
    });
  }

  function placeBasic(type: FurnitureType): void {
    place({ typeId: type.id, size: [...type.defaultSize], color: type.color });
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
    // 3D は modelKey を持つ。切り抜き（2D）は imageKey だけ
    const shown = [...models].reverse().filter((model) => (model.modelKey ? showSolid : showFlat));

    const ordered: HTMLElement[] = [];
    if (filter !== 'basic') ordered.push(addTile);
    ordered.push(...syncThumbs(cutoutNodes, cutting, createCutoutThumb));
    ordered.push(...syncThumbs(jobNodes, running, createJobThumb));
    ordered.push(...syncThumbs(failedNodes, failures, (item) => createFailedThumb(item, toggleFailure)));
    ordered.push(...syncThumbs(modelNodes, shown, (model) => createModelThumb(model, placeGenerated, openEditor)));
    if (filter === 'all' || filter === 'basic') ordered.push(...basicTiles);
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
  const modelNodes = new Map<string, ThumbNode<GeneratedModel>>();
  const addTile = createAddTile(openChooser);
  const basicTiles = FURNITURE_TYPES.map((type) => createBasicTile(type, placeBasic));

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

/** 基本の家具のタイル。色の四角と名前。押すと空いている場所に置く */
function createBasicTile(type: FurnitureType, place: (type: FurnitureType) => void): HTMLElement {
  const thumb = createThumb(type.name);
  thumb.image.classList.add('is-basic');
  const swatch = document.createElement('span');
  swatch.className = 'thumb__swatch';
  swatch.style.background = type.color;
  thumb.image.append(swatch);
  thumb.button.addEventListener('click', () => place(type));
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
  /** URL を貼る欄の置き場。「商品の URL から」の行の見出しの下 */
  productSlot: HTMLElement;
  /** 欄が開いている間、その行を開いた見た目にする */
  markProductOpen(opened: boolean): void;
  open(): void;
  close(): void;
  /** ログインの結果を伝える。何も言わないと「ログインしたのに何も起きない」に見える */
  showSignedIn(error?: string | null): void;
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

  const menu = document.createElement('div');
  menu.className = 'ways';
  const rows: HTMLButtonElement[] = [];
  /** 「商品の URL から」の行。見出し（押すもの）と、その下で開く欄をまとめる */
  const productRow = document.createElement('div');
  productRow.className = 'way-group';
  const productSlot = document.createElement('div');
  productSlot.className = 'way__open';
  const WAYS: { way: Way; icon: IconName; label: string; note: string }[] = [
    { way: 'photo', icon: 'camera', label: '写真から', note: '写真の家具だけを切り抜いて、2D で置けます（数秒）' },
    { way: 'product', icon: 'link', label: '商品の URL から', note: '楽天市場の商品ページから取り込み、実際の寸法の 2D で置けます' },
    { way: 'model', icon: 'cube', label: '3D モデルで作る', note: '立体なので、向きを変えて置けます（約 3 分）' },
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
    if (way === 'product') {
      row.setAttribute('aria-expanded', 'false');
      productRow.append(row, productSlot);
      menu.append(productRow);
    } else {
      menu.append(row);
    }
  }

  function markProductOpen(opened: boolean): void {
    productRow.classList.toggle('is-open', opened);
    rows[WAYS.findIndex((item) => item.way === 'product')].setAttribute('aria-expanded', String(opened));
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
    // ポップアップでログインできた直後。商品の URL はそのまま続けられる。
    // 写真はファイル選択を開けないので、もう一度押してもらう
    if (pending === 'product') actions.product();
    else showSignedIn();
    pending = null;
  });

  element.append(head, menu, loginPanel.element, loginHint, authNote, signedInNote, createIdentity());

  function showSignedIn(error: string | null = null): void {
    signedInNote.classList.toggle('is-error', error !== null);
    signedInNote.textContent = error ?? 'ログインしました。もう一度「写真から」を押して写真を選んでください';
    signedInNote.hidden = false;
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

  return { element, productSlot, markProductOpen, open, close, showSignedIn };
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
  model: GeneratedModel,
  place: (model: GeneratedModel) => void,
  edit: (model: GeneratedModel) => void
): ThumbNode<GeneratedModel> {
  const thumb = createThumb(model.name);
  let current = model;
  thumb.button.addEventListener('click', () => place(current));
  const preview = createPreviewImage(thumb.image);
  // 「すべて」で 2D と見分けられるように、3D には印を付ける
  if (model.modelKey) thumb.image.append(createTag('3D'));

  // 右上の「⋯」で編集へ。押しても置いてしまわないよう、下のボタンには渡さない
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'thumb__more';
  more.textContent = '⋯';
  more.setAttribute('aria-label', `${model.name} を編集`);
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    edit(current);
  });
  thumb.image.append(more);

  function update(next: GeneratedModel): void {
    current = next;
    thumb.name.textContent = next.name;
    more.setAttribute('aria-label', `${next.name} を編集`);
    preview.show(next.previewKey);
  }
  update(model);
  return { element: thumb.element, update, dispose: preview.dispose };
}

/**
 * 作ったモデルの編集の姿。名前とアイコンを変え、削除もここから。
 *
 * 削除は「このモデルを削除」→ 確認 → 「削除する」の二段階。確認にはアイコンも出し、
 * 同じ名前のモデルがあっても取り違えないようにする。
 * 一覧から外すだけで、置いてある家具はそのまま残る（removeModel の挙動）
 */
function createModelEditor(onClose: () => void): { element: HTMLElement; open(model: GeneratedModel): void } {
  const element = document.createElement('div');
  element.className = 'lib__edit';
  element.hidden = true;
  let current: GeneratedModel | null = null;

  const head = document.createElement('div');
  head.className = 'edit__head';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'button is-text is-small';
  back.textContent = '‹ 戻る';
  back.addEventListener('click', close);
  const title = document.createElement('span');
  title.className = 'edit__title';
  title.textContent = '家具の編集';
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

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'button is-quiet is-small is-danger-outline';
  remove.textContent = 'この家具を削除';
  remove.addEventListener('click', () => {
    confirm.hidden = false;
    remove.hidden = true;
  });

  const confirm = document.createElement('div');
  confirm.className = 'confirm';
  confirm.hidden = true;
  const confirmRow = document.createElement('div');
  confirmRow.className = 'confirm__what';
  const confirmIcon = document.createElement('span');
  confirmIcon.className = 'thumb__img confirm__icon';
  const confirmIconPreview = createPreviewImage(confirmIcon);
  const confirmText = document.createElement('span');
  confirmRow.append(confirmIcon, confirmText);
  const confirmNote = document.createElement('p');
  confirmNote.className = 'hint';
  confirmNote.textContent = '部屋や写真に置いた家具はそのまま残ります';
  const confirmButtons = document.createElement('div');
  confirmButtons.className = 'confirm__buttons';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'button is-quiet is-small';
  cancel.textContent = 'やめる';
  cancel.addEventListener('click', () => {
    confirm.hidden = true;
    remove.hidden = false;
  });
  const doRemove = document.createElement('button');
  doRemove.type = 'button';
  doRemove.className = 'button is-danger is-small';
  doRemove.textContent = '削除する';
  doRemove.addEventListener('click', () => {
    if (!current) return;
    removeModel(current.id);
    close();
  });
  confirmButtons.append(cancel, doRemove);
  confirm.append(confirmRow, confirmNote, confirmButtons);

  element.append(head, iconRow, nameField, productField, actions, divider, remove, confirm);

  function open(model: GeneratedModel): void {
    current = model;
    nameInput.value = model.name;
    iconPreview.show(model.previewKey);
    confirmIconPreview.show(model.previewKey);
    confirmText.textContent = `「${model.name}」を削除します。よろしいですか？`;
    productField.hidden = !model.product;
    if (model.product) {
      productNote.textContent = model.size
        ? `${model.product.shop}・幅 ${(model.size[0] * 100).toFixed(0)} × 奥行 ${(model.size[2] * 100).toFixed(0)} × 高さ ${(model.size[1] * 100).toFixed(0)} cm`
        : `${model.product.shop}・寸法を取得できませんでした。「操作」タブで大きさを調整してください`;
      productLinkSlot.replaceChildren(createProductLink(model.product));
    }
    confirm.hidden = true;
    remove.hidden = false;
    element.hidden = false;
  }

  function close(): void {
    current = null;
    element.hidden = true;
    onClose();
  }

  return { element, open };
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
        ? progressFor(current.serverPhase, elapsedInPhase(current)).ratio
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
      return progressFor(job.serverPhase, elapsedInPhase(job)).centerText;
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
