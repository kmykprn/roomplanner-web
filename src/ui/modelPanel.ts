/**
 * 家具のページ。置ける家具をタイルの格子に並べ、押すと出るメニューから、いまのモード（部屋／写真）に置く。
 *
 *   格子の先頭 … 「＋ 追加」。押すと一覧と入れ替わりに「家具を追加」の姿が出る。
 *                入口は 2 つで、2D（切り抜き）を作る（数秒）／3D モデルを作る（数分）。
 *                匿名ならその姿の中でログインを求める（ui/loginPanel.ts）。
 *                3D は 2D から作るので、作る前に元の 2D を選ばせる
 *   続き       … 作った家具。作成中はその場で円が進み、できあがると押せる姿になる。
 *                失敗は「!」のタイルで、押すと格子の下に理由と「とじる」が出る。
 *                押すと出るメニュー（createTileActions）で、置く形（2D / 3D）を選んで置く。
 *                メニューの［✎ 編集］で、編集の姿（アイコン・名前・サイズ・3D の作成・削除）に切り替わる。
 *
 * 最初から入っている椅子・ソファ（サンプル）も作った家具と同じ扱い。2D は切り抜きの板、3D は向きを変えられるモデル。
 *
 * **1 つの家具は、2D と 3D を両方持っていても 1 枚のタイルにする。** アイコン・名前・大きさは 2D と 3D で同じなので、
 * 別々に並べると同じ家具が 2 回出て、一覧が散らかり、目当ての家具も探しにくくなる（通販の一覧の色違いと同じ考え方）。
 * 3D も持つ家具にだけ、タイルの右下に小さな立方体の印を付ける（2D はほぼすべての家具が持っているので印は付けない）。
 *
 * 3D 生成は約 3 分かかるので、**待たせる画面ではなく、待たせない画面**にする。
 * ここは進み具合を映すだけで、進行そのものは core/generation.ts と core/cutout.ts が持っている。
 */

import type { PlacedFurniture } from '@/config/furniture';
import { IS_CONFIGURED } from '@/config/api';
import { activeScene, isPhotoMode } from '@/core/mode';
import { preparingRatio, progressFor } from '@/core/progress';
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
  isLocalCutoutDisabled,
  retryLocalCutout,
  startCutout,
  type CutoutJob,
} from '@/core/cutout';
import { createProductLink } from '@/ui/productLink';
import {
  PLACEHOLDER_COLOR,
  modelLibrary,
  removeModel,
  renamePlacedCopies,
  updateModel,
  type GeneratedModel,
  type ModelFacet,
} from '@/core/modelLibrary';
import { authState, redirectLogin } from '@/platform/auth';
import { refreshWallet, walletState, remainingGenerations } from '@/core/wallet';
import { NO_CREDITS_MESSAGE } from '@/platform/api';
import { pickImages } from '@/platform/picker';
import { createHeightStep } from '@/ui/heightStep';
import { createSizeField } from '@/ui/sizeField';
import { placementSize, setModelHeight } from '@/core/furnitureHeight';
import { createIcon } from '@/ui/icons';
import { createLoginPanel } from '@/ui/loginPanel';
import { createPreviewImage } from '@/ui/previewImage';
import { createProgressRing } from '@/ui/progressRing';
import { createFurniturePreview, type FurniturePreview } from '@/ui/furniturePreview';
import { SAMPLE_MODELS } from '@/config/samples';
import { createTicketSheet } from '@/ui/ticketSheet';
import { createWalletBar } from '@/ui/walletBar';

export interface ModelPanelOptions {
  /** モデルを置いた直後に呼ぶ。タブの移動を抑える判断に使う */
  onPlaced(id: string): void;
}

/** 家具の作り方。「家具を追加」の 2 行 */
type Way = 'cutout' | 'model';

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

  const grid = document.createElement('div');
  grid.className = 'tiles';

  /** 押した失敗の理由。タイルには収まらないので格子の下に出す */
  const failureDetail = document.createElement('div');
  failureDetail.className = 'lib__failure';
  failureDetail.hidden = true;
  let openFailureId: string | null = null;

  /**
   * 端末で切り抜く途中でアプリが落ちた端末では、以後サーバーで切り抜いている（core/cutout.ts）。
   * そのことを伝え、端末でもう一度試す入口を出す（押すと次の写真から端末で切り抜く）
   */
  const localNotice = document.createElement('div');
  localNotice.className = 'lib__failure lib__local';
  localNotice.hidden = !isLocalCutoutDisabled();
  const localMessage = document.createElement('p');
  localMessage.className = 'hint';
  localMessage.textContent = '端末で切り抜く途中でアプリが落ちたことがあるので、写真はサーバーで切り抜いています';
  const retryLocal = document.createElement('button');
  retryLocal.type = 'button';
  retryLocal.className = 'button is-quiet is-small';
  retryLocal.textContent = '端末でもう一度試す';
  retryLocal.addEventListener('click', () => {
    retryLocalCutout();
    localNotice.hidden = true;
  });
  localNotice.append(localMessage, retryLocal);

  normal.append(grid, failureDetail, localNotice);

  // --- 作り方を選ぶ姿。＋ を押すと一覧と入れ替わりに出る ---
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

  // 家具を押したときに下から出すメニュー。大きな見本・置く形（2D / 3D）・「部屋に追加」（写真なら「背景に追加」）、見出しの右に［✎ 編集］
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

  /** 家具を、メニューで選んだ形で置く。2D なら切り抜きの板を、3D ならモデルを置く */
  function placeGenerated(model: GeneratedModel, facet: ModelFacet): void {
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

    // 並び: ＋、切り抜き中（数秒で終わる）、3D の作成中、失敗、できあがったものを新しい順、基本の家具。
    //
    // **タイルは作り直さず、id で使い回す。** 作成中は状態更新のたびにここが呼ばれる。
    // 毎回作り直すと画像の読み込みが一瞬遅れて、できあがったモデルの一覧が
    // ちらつく（実機で確認）。要素を保ったまま並べ替えれば画像は読み直されない
    const cutouts = cutoutState.get().jobs;
    // 2D の家具から作っている 3D は、別のタイルにせず、その家具のタイルの上で円を回す（createModelThumb）。
    // 別のタイルが増えると、同じ家具が 2 つあるように見えるため。元の家具が無い作成だけ、作成中のタイルを出す
    const making = new Map<string, GenerationJob>();
    for (const job of jobs) {
      if (job.phase !== 'failed' && job.targetModelId && models.some((model) => model.id === job.targetModelId)) {
        making.set(job.targetModelId, job);
      }
    }
    const running = jobs.filter((job) => job.phase !== 'failed' && !(job.targetModelId && making.has(job.targetModelId)));
    const cutting = cutouts.filter((job) => job.phase !== 'failed');
    const failures: FailedItem[] = [
      ...cutouts
        .filter((job) => job.phase === 'failed')
        .map((job) => ({ id: job.id, name: job.fileName, error: job.error, dismiss: () => dismissCutoutError(job.id) })),
      ...jobs
        .filter((job) => job.phase === 'failed')
        .map((job) => ({ id: job.id, name: job.fileName, error: job.error, dismiss: () => dismissError(job.id) })),
    ];
    // 2D と 3D を両方持つ家具も 1 枚。新しい順
    const shown: ModelItem[] = [...models].reverse().map((model) => ({ id: model.id, model, making: making.get(model.id) ?? null }));

    const ordered: HTMLElement[] = [];
    ordered.push(addTile);
    ordered.push(...syncThumbs(cutoutNodes, cutting, createCutoutThumb));
    ordered.push(...syncThumbs(jobNodes, running, createJobThumb));
    ordered.push(...syncThumbs(failedNodes, failures, (item) => createFailedThumb(item, toggleFailure)));
    ordered.push(...syncThumbs(modelNodes, shown, (item) => createModelThumb(item, tileActions.open)));
    grid.replaceChildren(...ordered);

    // 押した失敗がまだあれば理由を出す。とじるで見えなくなったら畳む
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
  const modelNodes = new Map<string, ThumbNode<ModelItem>>();
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
      generationState.get().jobs.some((job) => job.phase !== 'failed' && job.phase !== 'saving') ||
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
  // 行の左の見本は、サンプルの椅子。2D の行は切り抜きが上下に揺れ、3D の行は 3D が回る（ui/furniturePreview.ts）。
  // 作る前に「2D を作るとこう、3D を作るとこう」が見て分かるように。前はカメラと立方体のアイコンだった
  const sample = SAMPLE_MODELS.find((model) => model.id === 'sample-chair') ?? SAMPLE_MODELS[0];
  const WAYS: { way: Way; facet: ModelFacet; label: string; note: string }[] = [
    { way: 'cutout', facet: 'flat', label: '2D（切り抜き）を作る', note: '画像から切り抜きます（数秒）' },
    { way: 'model', facet: 'solid', label: '3D モデルを作る', note: '置いたあと向きを変えられます（数分）' },
  ];
  /** 行ごとの見本。画面を開いている間だけ動かす（3D は開いている間だけ描く） */
  const samples: { preview: FurniturePreview; facet: ModelFacet }[] = [];
  for (const { way, facet, label, note } of WAYS) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'way';
    const preview = createFurniturePreview();
    preview.element.classList.add('is-mini');
    preview.element.setAttribute('aria-hidden', 'true');
    samples.push({ preview, facet });
    const text = document.createElement('span');
    text.className = 'way__text';
    const strong = document.createElement('span');
    strong.className = 'way__label';
    strong.textContent = label;
    const small = document.createElement('span');
    small.className = 'way__note';
    small.textContent = note;
    text.append(strong, small);
    // 押すと次へ進む行だと分かるように、右に「›」
    const chevron = document.createElement('span');
    chevron.className = 'way__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    row.append(preview.element, text, chevron);
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

  // いちばん上に、3D を作れる残りの回数と［購入］（ログインしていなければ［ログイン］）
  const ticketSheet = createTicketSheet();
  const walletBar = createWalletBar({
    onLogin: () => {
      signedInNote.hidden = true;
      loginPanel.open();
      renderState();
    },
    onBuy: ticketSheet.open,
  });

  element.append(head, walletBar.element, menu, loginPanel.element, authNote, signedInNote, ticketSheet.element);

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
    const { status } = authState.get();
    // 認証できないとこのあと何をしても失敗する。黙って止まると原因が分からないので出す
    const authFailed = status === 'failed';
    for (const row of rows) row.disabled = authFailed;
    authNote.hidden = !authFailed;
    authNote.textContent = authFailed ? authFailureMessage() : '';
    // ログインを求めている間は行を引っ込める（同じ場所に出す）
    menu.hidden = !loginPanel.element.hidden;
  }

  function open(): void {
    signedInNote.hidden = true;
    pending = null;
    afterLoginNote = null;
    loginPanel.close();
    ticketSheet.close();
    renderState();
    element.hidden = false;
    for (const { preview, facet } of samples) preview.show(sample, facet);
    // 回数は別の端末で使ったり、券を買ったりして変わるので、開くたびに取り直す
    void refreshWallet();
  }

  function close(): void {
    element.hidden = true;
    for (const { preview } of samples) preview.stop();
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
 * 家具のタイルを押したときに、画面の下から出すメニュー。
 *
 *   見出し   … 家具の名前と、右に控えめな［✎ 編集］
 *   見本     … 大きな見本（ui/furniturePreview.ts）。3D はゆっくり回り、2D は上下にゆっくり揺れる
 *   置く形   … 2D と 3D を両方持つ家具だけ、見本の付いた 2 つの選択肢を出す。最初は 3D。選ぶと見本も切り替わる
 *              2D だけの家具には、代わりに「3D モデルを作る」を出す（押すと編集の姿の、3D を作る欄へ）
 *   追加     … 親指で押しやすい大きな［部屋に追加］（写真のときは［背景に追加］）。主な操作はこれ 1 つ
 *
 * 選択肢を文字だけの切り替えにしないのは、どちらを選ぶと何が置かれるのかが見て分からないため。
 * 選んだ形の姿を大きな見本で見せる（通販の色違いの選び方と同じ考え方）。
 *
 * **押しただけでは置かない。** 編集したいのに置いてしまわないよう、メニューの［追加］で置く。
 * 外側（暗くした所）を押すと閉じる
 */
function createTileActions(actions: {
  onPlace(model: GeneratedModel, facet: ModelFacet): void;
  onEdit(model: GeneratedModel): void;
}): {
  element: HTMLElement;
  open(model: GeneratedModel): void;
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
  const name = document.createElement('div');
  name.className = 'tile-actions__name';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'tile-actions__edit';
  const editLabel = document.createElement('span');
  editLabel.textContent = '編集';
  edit.append(createPencilIcon(), editLabel);
  head.append(name, edit);

  const preview = createFurniturePreview();

  // 置く形の選択肢。見本の画像と「2D 切り抜き」「3D 立体」
  const options = document.createElement('div');
  options.className = 'tile-actions__options';
  options.setAttribute('role', 'group');
  options.setAttribute('aria-label', '置く形');
  const flatOption = createFacetOption('2D', '切り抜き', false);
  const solidOption = createFacetOption('3D', '立体', true);
  options.append(flatOption.button, solidOption.button);

  // 2D だけの家具に出す。押すと編集の姿の、3D を作る欄へ（回数を使うので、ここでは作り始めない）
  const makeModel = document.createElement('button');
  makeModel.type = 'button';
  makeModel.className = 'tile-actions__make';
  const makeLabel = document.createElement('span');
  makeLabel.textContent = '3D モデルを作る';
  makeModel.append(createIcon('cube'), makeLabel);

  const place = document.createElement('button');
  place.type = 'button';
  place.className = 'button tile-actions__button';

  sheet.append(head, preview.element, options, makeModel, place);
  element.append(dim, sheet);

  let current: GeneratedModel | null = null;
  let facet: ModelFacet = 'solid';

  /** 置く形を選ぶ。選択肢と見本を合わせて変える */
  function choose(next: ModelFacet): void {
    if (!current) return;
    facet = next;
    flatOption.setPressed(next === 'flat');
    solidOption.setPressed(next === 'solid');
    preview.show(current, next);
  }

  function close(): void {
    element.hidden = true;
    current = null;
    preview.stop();
  }
  /** 閉じてから選んだことをする（置く・編集を開く）。先に閉じないと、編集の姿の上にメニューが残る */
  function closeThen(action: (model: GeneratedModel) => void): void {
    const model = current;
    close();
    if (model) action(model);
  }
  dim.addEventListener('click', close);
  flatOption.button.addEventListener('click', () => choose('flat'));
  solidOption.button.addEventListener('click', () => choose('solid'));
  place.addEventListener('click', () => {
    const chosen = facet;
    closeThen((model) => actions.onPlace(model, chosen));
  });
  edit.addEventListener('click', () => closeThen(actions.onEdit));
  makeModel.addEventListener('click', () => closeThen(actions.onEdit));

  return {
    element,
    open(model) {
      current = model;
      name.textContent = model.name;
      sheet.setAttribute('aria-label', model.name);
      // 開くたびに、いまの置き先の呼び名にする
      place.textContent = isPhotoMode() ? '背景に追加' : '部屋に追加';
      const hasFlat = model.imageKey !== null;
      const hasSolid = model.modelKey !== null;
      // 選ぶものがあるときだけ選択肢を出す。片方しか無ければ、その形で置く
      options.hidden = !(hasFlat && hasSolid);
      makeModel.hidden = hasSolid;
      flatOption.showIcon(model);
      solidOption.showIcon(model);
      element.hidden = false;
      choose(hasSolid ? 'solid' : 'flat');
    },
    close,
  };
}

/** 置く形の選択肢 1 つ。小さな見本と、形の名前・ひとこと */
function createFacetOption(
  label: string,
  note: string,
  solid: boolean
): { button: HTMLButtonElement; setPressed(pressed: boolean): void; showIcon(model: GeneratedModel): void } {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'facet-option';
  const mini = document.createElement('span');
  mini.className = 'facet-option__mini';
  const icon = createPreviewImage(mini);
  // 3D の小さな見本は 2D と同じ画像なので、一覧のタイルと同じ立方体の印で見分ける
  if (solid) mini.append(createSolidMark());
  const text = document.createElement('span');
  const title = document.createElement('b');
  title.textContent = label;
  const small = document.createElement('small');
  small.textContent = note;
  text.append(title, small);
  button.append(mini, text);
  return {
    button,
    setPressed: (pressed) => button.setAttribute('aria-pressed', String(pressed)),
    showIcon: (model) => icon.show({ cutoutKey: model.imageKey, previewKey: model.previewKey }),
  };
}

/** 3D も持つ家具の印。タイルの右下の、白い丸の中の小さな立方体 */
function createSolidMark(): HTMLElement {
  const mark = document.createElement('span');
  mark.className = 'solid-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.append(createIcon('cube'));
  return mark;
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

/** 一覧の家具のタイル 1 枚。making は、この家具から作っている最中の 3D（無ければ null） */
interface ModelItem {
  id: string;
  model: GeneratedModel;
  making: GenerationJob | null;
}

/**
 * 家具のタイル。押すとメニューを開く（置くのはメニューから）。3D も持つなら右下に立方体の印。
 * この家具から 3D を作っている間は、画像の上で円を回し、名前の所に「準備中」「あと 2 分」を出す。
 * 作っている間も押せる（2D はメニューから置ける）
 */
function createModelThumb(item: ModelItem, open: (model: GeneratedModel) => void): ThumbNode<ModelItem> {
  const thumb = createThumb(item.model.name);
  let current = item.model;
  thumb.button.addEventListener('click', () => open(current));
  const preview = createPreviewImage(thumb.image);
  const solidMark = createSolidMark();
  const ring = createProgressRing();
  thumb.image.append(solidMark, ring.element);

  function update(next: ModelItem): void {
    const { model, making } = next;
    current = model;
    thumb.name.textContent = making ? describe(making) : model.name;
    solidMark.hidden = model.modelKey === null || making !== null;
    thumb.image.classList.toggle('is-running', making !== null);
    ring.setVisible(making !== null);
    if (making) ring.update(jobRingRatio(making), '');
    const label = model.modelKey ? `${model.name}（3D あり）` : model.name;
    thumb.button.setAttribute('aria-label', making ? `${label}: 3D を作っています（${describe(making)}）` : label);
    preview.show({ cutoutKey: model.imageKey, previewKey: model.previewKey });
  }
  update(item);
  return { element: thumb.element, update, dispose: preview.dispose };
}

/**
 * 作った家具の編集の姿。名前とサイズを変え、3D がまだ無ければ作り、削除もここから。いちばん上にアイコンを出す。
 *
 * **2D と 3D をまとめて 1 つの家具として編集する。** アイコン・名前・大きさは 2D と 3D で同じ。
 * 削除も家具ごと（2D と 3D の両方）消す。一覧でも 1 枚のタイルなので、片方だけ消す操作は置かない。
 *
 * 削除は「この…を完全に削除」→ 確認 → 「削除する」の二段階。確認にはアイコンも出し、
 * 同じ名前の家具があっても取り違えないようにする。
 * 一覧から外すだけで、置いてある家具はそのまま残る（removeModel の挙動）
 */
interface ModelEditorActions {
  onClose(): void;
  /** 切り抜き（2D）の家具から 3D を作る */
  onMakeModel(model: GeneratedModel): void;
}

function createModelEditor({ onClose, onMakeModel }: ModelEditorActions): {
  element: HTMLElement;
  open(model: GeneratedModel): void;
  close(): void;
} {
  const element = document.createElement('div');
  element.className = 'lib__edit';
  element.hidden = true;
  let current: GeneratedModel | null = null;
  /**
   * サイズの欄に出す形。3D があれば 3D の形（奥行きも出す）、無ければ 2D の形。
   * 高さは 2D と 3D で同じ値を使うので、どちらの形で出しても保存される高さは同じ
   */
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

  // 3D がまだ無い家具にだけ出す。3D にすると向きを変えて置ける
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
  cancel.textContent = 'キャンセル';
  cancel.addEventListener('click', () => {
    modal.hidden = true;
  });
  const doRemove = document.createElement('button');
  doRemove.type = 'button';
  doRemove.className = 'button is-danger is-small';
  doRemove.textContent = '削除';
  doRemove.addEventListener('click', () => {
    if (!current) return;
    removeModel(current.id);
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
    const { status, trialRemaining, credits, unmetered } = walletState.get();
    // 回数を数えない利用者には、残りの回数を出さない（減らないので意味が無い）
    if (status !== 'ready' || unmetered) return '';
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

  function open(model: GeneratedModel): void {
    current = model;
    facet = model.modelKey ? 'solid' : 'flat';
    title.textContent = '家具の編集';
    nameInput.value = model.name;
    sizeField.show(placementSize(model, facet), facet === 'flat');
    iconPreview.show({ cutoutKey: model.imageKey, previewKey: model.previewKey });
    confirmIconPreview.show({ cutoutKey: model.imageKey, previewKey: model.previewKey });
    confirmTitle.textContent = 'この家具を削除します';
    confirmText.textContent = model.name;
    remove.textContent = 'この家具を完全に削除';
    // 3D 化は 3D がまだ無い家具だけ（3D は 2D から作るので、2D も要る）
    modelField.hidden = model.modelKey !== null || model.imageKey === null;
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
  // 実行が始まるまでも円を少しずつ進める（0 のままだと、押しても反応していないように見える）
  const ring = createProgressRing();
  thumb.image.append(ring.element, createTag('3D'));

  function update(current: GenerationJob): void {
    thumb.name.textContent = describe(current);
    ring.update(jobRingRatio(current), '');
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

/** 作成中の 3D の円の進み。作業が始まるまでも少しずつ進め、始まったらその続きから進む */
function jobRingRatio(job: GenerationJob, now = Date.now()): number {
  switch (job.phase) {
    case 'uploading':
      return preparingRatio('uploading', (now - job.createdAt) / 1000);
    case 'queued':
      return preparingRatio('queued', (now - (job.startedAt ?? now)) / 1000);
    case 'running':
    case 'saving':
      return progressFor(job.serverPhase, elapsedInPhase(job), job.engine).ratio;
    case 'failed':
      return 0;
  }
}

/**
 * サムネイルの下に出す短い状態。幅 72px に収まる長さにする。
 * 作業が始まるまでは、送っている間も順番待ちも「準備中」（「送信中」「順番待ち」は利用者にとって意味が無い）
 */
function describe(job: GenerationJob): string {
  switch (job.phase) {
    case 'uploading':
    case 'queued':
      return '準備中';
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
