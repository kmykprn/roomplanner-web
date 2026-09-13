/**
 * 「家具」タブ。置ける家具を並べ、押すといまのモード（部屋／写真）に置く。
 *
 *   1 段目 … 「＋ 写真から家具を作る」。写真から家具だけを切り抜く（数秒）。
 *            その下に、時間のかかる 3D モデルの作成（約 9 分）への入口を小さく置く。
 *            どちらも匿名のままなら、写真を選ぶ前にログインを求める（ui/loginPanel.ts）
 *   2 段目 … 作った家具。作成中はその場で円が進み、できあがると押せる姿になる。
 *            右上の「⋯」で編集の姿（名前・アイコン・削除）に切り替わる。× で即消せるのは
 *            簡単すぎたので、削除は編集の中で二段階にした
 *   3 段目 … 基本の家具（椅子・テーブル…）
 *
 * 3D 生成は約 8 分かかるので、**待たせる画面ではなく、待たせない画面**にする。
 * ここは進み具合を映すだけで、進行そのものは core/generation.ts と core/cutout.ts が持っている。
 */

import { FURNITURE_TYPES, type PlacedFurniture } from '@/config/furniture';
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
  type CutoutJob,
} from '@/core/cutout';
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
import { createLoginPanel } from '@/ui/loginPanel';
import { createPreviewImage } from '@/ui/previewImage';
import { createProgressRing } from '@/ui/progressRing';

export interface ModelPanelOptions {
  /** モデルを置いた直後に呼ぶ。タブの移動を抑える判断に使う */
  onPlaced(id: string): void;
}

export function createModelPanel({ onPlaced }: ModelPanelOptions): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'lib';

  // --- 1 段目: 写真から作る。ボタンの文字が説明を兼ねるので、案内は出さない ---
  const generateRow = document.createElement('div');
  const generateButton = document.createElement('button');
  generateButton.className = 'button lib__generate';
  generateButton.textContent = '＋ 写真から家具を作る';
  generateButton.addEventListener('click', () => void pickAndStart(startCutout));
  /**
   * 3D モデルの作成への入口。切り抜きが基本で、こちらは時間と費用がかかるので小さく出す。
   * 切り抜きでは向きを変えられない（左右反転だけ）ので、回したい人向け
   */
  const generate3dButton = document.createElement('button');
  generate3dButton.className = 'button is-text is-small lib__generate-3d';
  generate3dButton.textContent = '3D モデルとして作る（約 9 分）';
  generate3dButton.addEventListener('click', () => void pickAndStart(startGeneration));

  /** 匿名なら**写真を選ぶ前に**ログインを求める。iOS のリダイレクトは写真を持ち越せないため */
  async function pickAndStart(start: (files: File[]) => Promise<void>): Promise<void> {
    signedInNote.hidden = true;
    if (authState.get().anonymous) {
      loginPanel.open();
      return;
    }
    const files = await pickImages();
    if (files.length > 0) void start(files);
  }
  /** 押す前から、ログインが要ることが分かるようにしておく。匿名のときだけ出す */
  const loginHint = document.createElement('p');
  loginHint.className = 'hint lib__login-hint';
  loginHint.textContent = '作成には Google ログインが必要です';
  /** 認証できないときだけ出す。押せない理由が無いと、壊れているように見える */
  const authNote = document.createElement('p');
  authNote.className = 'hint is-error';
  authNote.hidden = true;
  /**
   * ログインできた直後に出す。ポップアップなら閉じた瞬間、iOS のリダイレクトなら
   * 戻ってきた起動時。何も言わないと「ログインしたのに何も起きない」に見える。
   * 次にボタンを押したら消す
   */
  const signedInNote = document.createElement('p');
  signedInNote.className = 'hint';
  signedInNote.hidden = true;
  generateRow.append(generateButton, generate3dButton, loginHint, authNote, signedInNote);

  // ログインを求めるパネル。作成ボタンの場所と入れ替わりで出る
  const loginPanel = createLoginPanel(() => showSignedIn());

  function showSignedIn(error: string | null = null): void {
    signedInNote.classList.toggle('is-error', error !== null);
    signedInNote.textContent =
      error ?? 'ログインできました。もう一度「＋ 写真から家具を作る」を押して写真を選んでください';
    signedInNote.hidden = false;
  }

  // --- 2 段目: 作った家具 ---
  const made = document.createElement('div');
  const madeLabel = document.createElement('p');
  madeLabel.className = 'lib__label';
  madeLabel.textContent = '作った家具';
  const thumbs = document.createElement('div');
  thumbs.className = 'thumbs';
  /** 失敗した作成。サムネイルには収まらないので、下に文で出す */
  const failures = document.createElement('div');
  failures.className = 'lib__failures';
  made.append(madeLabel, thumbs, failures);

  // --- 3 段目: 基本の家具 ---
  const basic = document.createElement('div');
  const basicLabel = document.createElement('p');
  basicLabel.className = 'lib__label';
  basicLabel.textContent = '基本の家具';
  basic.append(basicLabel, createBasicGrid(place));

  /** 通常の姿。編集の間は引っ込める（「手前の範囲」と同じ作り） */
  const normal = document.createElement('div');
  normal.className = 'lib__normal';
  normal.append(generateRow, loginPanel.element, made, basic, createIdentity());
  const editor = createModelEditor(() => {
    normal.hidden = false;
  });
  panel.append(normal, editor.element);

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
      size: [...GENERATED_SIZE],
      color: PLACEHOLDER_COLOR,
      modelUrl: model.modelKey ?? undefined,
      imageUrl: model.imageKey ?? undefined,
      sourceImageKey: model.previewKey ?? undefined,
    });
  }

  function render(): void {
    const { jobs } = generationState.get();
    const { models } = modelLibrary.get();
    const { status, anonymous } = authState.get();

    // 認証できないとこのあと何をしても失敗する。
    // 黙って止まると原因が分からないので、ボタンの下に出す
    const authFailed = status === 'failed';
    generateButton.disabled = authFailed;
    generate3dButton.disabled = authFailed;
    authNote.hidden = !authFailed;
    authNote.textContent = authFailed ? authFailureMessage() : '';
    loginHint.hidden = authFailed || !anonymous;
    // ログインを求めている間は作成ボタンを引っ込める（同じ場所に出す）
    generateRow.hidden = !loginPanel.element.hidden;

    // 作成中のものを先頭に、できあがったものを新しい順に並べる。
    //
    // **サムネイルは作り直さず、id で使い回す。** 作成中は 15 秒ごとの状態更新で
    // ここが呼ばれる。毎回作り直すと画像の読み込みが一瞬遅れて、できあがったモデルの
    // 一覧がちらつく（実機で確認）。要素を保ったまま並べ替えれば画像は読み直されない
    const cutouts = cutoutState.get().jobs;
    const running = jobs.filter((job) => job.phase !== 'failed');
    const cutting = cutouts.filter((job) => job.phase !== 'failed');
    const failed = jobs.filter((job) => job.phase === 'failed');
    const failedCutouts = cutouts.filter((job) => job.phase === 'failed');
    made.hidden =
      running.length + cutting.length + failed.length + failedCutouts.length + models.length === 0;

    const ordered: HTMLElement[] = [];
    // 切り抜きは数秒で終わるので先頭。3D の作成はその後ろで長く待つ
    ordered.push(...syncThumbs(cutoutNodes, cutting, createCutoutThumb));
    ordered.push(...syncThumbs(jobNodes, running, createJobThumb));
    ordered.push(...syncThumbs(modelNodes, [...models].reverse(), (model) =>
      createModelThumb(model, placeGenerated, openEditor)
    ));
    thumbs.replaceChildren(...ordered);
    failures.replaceChildren(
      ...failedCutouts.map((job) => createFailure(job.fileName, job.error, () => dismissCutoutError(job.id))),
      ...failed.map((job) => createFailure(job.fileName, job.error, () => dismissError(job.id)))
    );
  }

  /** 表示中のサムネイル。切り抜き中・作成中・できあがったもので別に持つ */
  const cutoutNodes = new Map<string, ThumbNode<CutoutJob>>();
  const jobNodes = new Map<string, ThumbNode<GenerationJob>>();
  const modelNodes = new Map<string, ThumbNode<GeneratedModel>>();

  render();
  generationState.subscribe(render);
  cutoutState.subscribe(render);
  modelLibrary.subscribe(render);
  authState.subscribe(render);
  redirectLogin.subscribe((state) => {
    // iOS のリダイレクトから戻ってきた。写真は持ち越せていないので、選び直しを促す
    if (state.outcome === 'signed-in') showSignedIn();
    else if (state.outcome === 'failed') showSignedIn(state.error ?? 'ログインできませんでした');
    render();
  });
  // パネルの出し入れは hidden 属性の変化なので、状態の購読では拾えない
  new MutationObserver(render).observe(loginPanel.element, { attributeFilter: ['hidden'] });

  // 待っている間、状態そのものは変わらないので購読だけでは経過時間が止まる。
  // 8分待たせる画面で数字が動かないと、固まったように見える
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

/** 基本のモデルの一覧。押すと空いている場所に置く */
function createBasicGrid(
  place: (item: Omit<PlacedFurniture, 'id' | 'position' | 'rotationY'>) => void
): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const type of FURNITURE_TYPES) {
    const button = document.createElement('button');
    button.className = 'chip';
    const swatch = document.createElement('span');
    swatch.className = 'chip__swatch';
    swatch.style.background = type.color;
    button.append(swatch, type.name);
    button.addEventListener('click', () =>
      place({ typeId: type.id, size: [...type.defaultSize], color: type.color })
    );
    grid.appendChild(button);
  }
  return grid;
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
  iconButton.textContent = 'アイコンを選び直す';
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
  confirmNote.textContent = '置いてある家具はそのまま残ります';
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

  element.append(head, iconRow, nameField, actions, divider, remove, confirm);

  function open(model: GeneratedModel): void {
    current = model;
    nameInput.value = model.name;
    iconPreview.show(model.previewKey);
    confirmIconPreview.show(model.previewKey);
    confirmText.textContent = `「${model.name}」を削除します。よろしいですか？`;
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
    thumb.name.textContent = current.phase === 'failed' ? '切り抜けませんでした' : progress.label;
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
  thumb.image.append(ring.element);

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

/** 失敗した作成（切り抜きも 3D も同じ姿）。とじると、その失敗だけが消える */
function createFailure(fileName: string, error: string | null, dismiss: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row lib__failure';
  const message = document.createElement('p');
  message.className = 'hint is-error';
  message.textContent = `${fileName}: ${error ?? '作成できませんでした'}`;
  const closeButton = document.createElement('button');
  closeButton.className = 'button is-quiet is-small';
  closeButton.textContent = 'とじる';
  closeButton.addEventListener('click', dismiss);
  row.append(message, closeButton);
  return row;
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
  summary.textContent = '利用者ID';
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
    ? '認証できませんでした。通信を確かめて開き直してください'
    : 'この配信には生成の設定が入っていません（管理者にお伝えください）';
}

/** サムネイルの下に出す短い状態。幅 72px に収まる長さにする */
function describe(job: GenerationJob): string {
  switch (job.phase) {
    case 'uploading':
      return '送っています';
    case 'queued':
      return '順番待ち';
    case 'running':
      // 「あと5分」「まもなく」。見込みであって約束ではない（core/progress.ts）
      return progressFor(job.serverPhase, elapsedInPhase(job)).centerText;
    case 'saving':
      return '保存しています';
    case 'failed':
      return '作成できませんでした';
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
