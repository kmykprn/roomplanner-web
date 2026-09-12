/**
 * 「3Dモデル」タブ。置ける 3D モデルを並べ、押すといまのモード（部屋／写真）に置く。
 *
 *   1 段目 … 「＋ 写真から作る」。押したあとはタブを離れても、アプリを閉じても進行は続く
 *   2 段目 … 作ったモデル。作成中はその場で円が進み、できあがると押せる姿になる。
 *            × で保管庫から外す（置いてある家具はそのまま）
 *   3 段目 … 基本のモデル（椅子・テーブル…）
 *
 * 生成に約8分かかるので、**待たせる画面ではなく、待たせない画面**にする。
 * ここは進み具合を映すだけで、進行そのものは core/generation.ts が持っている。
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
  GENERATED_SIZE,
  PLACEHOLDER_COLOR,
  modelLibrary,
  removeModel,
  type GeneratedModel,
} from '@/core/modelLibrary';
import { getUid } from '@/platform/auth';
import { pickImages } from '@/platform/picker';
import { resolvePreview } from '@/platform/previewCache';
import { createProgressRing } from '@/ui/progressRing';

/** 何も作っていないときの案内。所要時間は工程の表示に任せる */
const IDLE_MESSAGE = '家具の写真から3Dモデルを作れます';

export interface ModelPanelOptions {
  /** モデルを置いた直後に呼ぶ。タブの移動を抑える判断に使う */
  onPlaced(id: string): void;
}

export function createModelPanel({ onPlaced }: ModelPanelOptions): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'lib';

  // --- 1 段目: 写真から作る ---
  const generateRow = document.createElement('div');
  generateRow.className = 'row';
  const generateButton = document.createElement('button');
  generateButton.className = 'button';
  generateButton.textContent = '＋ 写真から作る';
  generateButton.addEventListener('click', async () => {
    const files = await pickImages();
    if (files.length > 0) void startGeneration(files);
  });
  const status = document.createElement('p');
  status.className = 'hint lib__hint';
  generateRow.append(generateButton, status);

  // --- 2 段目: 作ったモデル ---
  const made = document.createElement('div');
  const madeLabel = document.createElement('p');
  madeLabel.className = 'lib__label';
  madeLabel.textContent = '作ったモデル';
  const thumbs = document.createElement('div');
  thumbs.className = 'thumbs';
  /** 失敗した作成。サムネイルには収まらないので、下に文で出す */
  const failures = document.createElement('div');
  failures.className = 'lib__failures';
  made.append(madeLabel, thumbs, failures);

  // --- 3 段目: 基本のモデル ---
  const basic = document.createElement('div');
  const basicLabel = document.createElement('p');
  basicLabel.className = 'lib__label';
  basicLabel.textContent = '基本のモデル';
  basic.append(basicLabel, createBasicGrid(place));

  panel.append(generateRow, made, basic, createIdentity());

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
      modelUrl: model.modelKey,
      sourceImageKey: model.previewKey ?? undefined,
    });
  }

  // 認証できないとこのあと何をしても失敗する。
  // 黙って止まると原因が分からないので、案内の場所に出す
  let authFailed = false;

  function render(): void {
    const { jobs } = generationState.get();
    const { models } = modelLibrary.get();

    generateButton.disabled = authFailed;
    status.classList.toggle('is-error', authFailed);
    status.textContent = authFailed ? authFailureMessage() : IDLE_MESSAGE;

    // 作成中のものを先頭に、できあがったものを新しい順に並べる
    const running = jobs.filter((job) => job.phase !== 'failed');
    const failed = jobs.filter((job) => job.phase === 'failed');
    made.hidden = running.length === 0 && failed.length === 0 && models.length === 0;
    thumbs.replaceChildren(
      ...running.map(createJobThumb),
      ...[...models].reverse().map((model) => createModelThumb(model, placeGenerated))
    );
    failures.replaceChildren(...failed.map(createFailure));
  }

  render();
  generationState.subscribe(render);
  modelLibrary.subscribe(render);

  // 待っている間、状態そのものは変わらないので購読だけでは経過時間が止まる。
  // 8分待たせる画面で数字が動かないと、固まったように見える
  setInterval(() => {
    if (generationState.get().jobs.some((job) => job.phase === 'running')) render();
  }, 1000);

  void getUid().catch(() => {
    authFailed = true;
    render();
  });

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
function createModelThumb(
  model: GeneratedModel,
  place: (model: GeneratedModel) => void
): HTMLElement {
  const thumb = createThumb(model.name);
  thumb.button.addEventListener('click', () => place(model));
  if (model.previewKey) {
    void resolvePreview(model.previewKey).then((url) => {
      if (url) thumb.image.style.backgroundImage = `url("${url}")`;
    });
  }

  const remove = document.createElement('button');
  remove.className = 'thumb__x';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `${model.name} を一覧から外す`);
  remove.addEventListener('click', (event) => {
    // 外すだけで置いてしまわないよう、下のボタンには渡さない
    event.stopPropagation();
    removeModel(model.id);
  });
  thumb.element.append(remove);
  return thumb.element;
}

/** 作成中のモデル。円で進み具合を出す。まだ押しても何も起きない */
function createJobThumb(job: GenerationJob): HTMLElement {
  const thumb = createThumb(describe(job));
  thumb.button.disabled = true;
  thumb.image.classList.add('is-running');
  if (job.previewUrl) thumb.image.style.backgroundImage = `url("${job.previewUrl}")`;

  // 円は小さく出すので中に文字は入れない。残り時間は下の名前の場所に出す。
  // 実行が始まるまでは残り時間が読めないので、円は空のまま
  const ring = createProgressRing();
  ring.update(
    job.phase === 'running' ? progressFor(job.serverPhase, elapsedInPhase(job)).ratio : 0,
    ''
  );
  thumb.image.append(ring.element);
  return thumb.element;
}

/** サムネイルの骨組み。画像の枠と、その下の名前 */
function createThumb(caption: string): {
  element: HTMLElement;
  button: HTMLButtonElement;
  image: HTMLElement;
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
  return { element, button, image };
}

function createFailure(job: GenerationJob): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row lib__failure';
  const message = document.createElement('p');
  message.className = 'hint is-error';
  message.textContent = `${job.fileName}: ${job.error ?? '作成できませんでした'}`;
  const closeButton = document.createElement('button');
  closeButton.className = 'button is-quiet is-small';
  closeButton.textContent = 'とじる';
  closeButton.addEventListener('click', () => dismissError(job.id));
  row.append(message, closeButton);
  return row;
}

/**
 * 利用者ID。限定公開のうちは、この識別子をサーバー側の許可リストに登録してもらう
 * 必要がある。個人情報は含まれない（匿名アカウントなので紐づく情報が無い）。
 * 全員が使えるようになったら、この表示ごと消してよい
 */
function createIdentity(): HTMLElement {
  const identity = document.createElement('details');
  identity.className = 'identity';
  const summary = document.createElement('summary');
  summary.textContent = '利用者ID';
  const uidText = document.createElement('code');
  uidText.textContent = '取得中…';
  identity.append(summary, uidText);
  void getUid()
    .then((uid) => {
      uidText.textContent = uid;
    })
    .catch(() => {
      uidText.textContent = '取得できませんでした';
    });
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
