/**
 * 写真から作った家具の保管庫。
 *
 * 作った家具は、置いた家具とは別に**ここに残る**。同じ家具を部屋にも写真にも、
 * 何度でも置けるようにするため。できあがっても勝手に置かず、ここに並ぶだけにする。
 *
 * ## 家具の「表現」は 1 つとは限らない
 *
 * 1 つの項目が、切り抜き（imageKey）と 3D モデル（modelKey）の**どちらか、または両方**を持つ。
 *
 *   切り抜きだけ … 数秒でできる基本の姿。板（ビルボード）として置く
 *   3D モデルだけ … 切り抜きができる前に作った項目（古い記録）
 *   両方         … 切り抜きを後から 3D にしたもの。描くときは 3D を優先する
 *
 * 配置（位置・向き・大きさ）と操作はどの表現でも同じで、描き方だけが変わる。
 * 表現が増えても、置いてある家具はそのまま新しい表現に差し替わる（upgradePlacedCopies）。
 *
 * 一覧そのものは localStorage に残す（数百バイト）。中身は大きいので別の場所にある。
 *   GLB … platform/modelCache.ts（Cache Storage）
 *   切り抜き PNG … platform/cutoutCache.ts（Cache Storage）
 *   アイコン用の縮小画像 … platform/previewCache.ts（IndexedDB）
 *
 * 中身は、保管庫の項目と置いた家具の両方から参照される。
 * どちらからも参照されなくなったときに捨てる（`releaseAssets`）。
 */

import { createStore } from '@/core/store';
import { roomScene } from '@/core/appState';
import { photoScene } from '@/core/photoState';
import { deleteModel } from '@/platform/modelCache';
import { deleteCutout } from '@/platform/cutoutCache';
import { deletePreview } from '@/platform/previewCache';
import type { PlacedFurniture } from '@/config/furniture';

const STORAGE_KEY = 'roomplanner.models';

/**
 * 作った家具の大きさ。
 *
 * 写真からは実寸が分からないので、いちばん長い辺が 1m に収まるようにする。
 * 縦横の比率は元のまま保たれる（3D は modelLoader、切り抜きは billboard を参照）。
 */
export const GENERATED_SIZE: [number, number, number] = [1, 1, 1];

/** 作った家具の色。中身が読めるまでの箱に使うだけ */
export const PLACEHOLDER_COLOR = '#bdb2a7';

export interface GeneratedModel {
  id: string;
  /** 一覧に出す名前。元写真のファイル名から拡張子を除いたもの */
  name: string;
  /** GLB の置き場（modelCache のキー）。3D にしていなければ null */
  modelKey: string | null;
  /** 切り抜き PNG の置き場（cutoutCache のキー）。切り抜きができる前の記録では null */
  imageKey: string | null;
  /** アイコンの縮小画像（previewCache のキー）。作れなかったときは null */
  previewKey: string | null;
  createdAt: number;
}

export interface ModelLibraryState {
  models: GeneratedModel[];
}

export const modelLibrary = createStore<ModelLibraryState>({ models: [] });

function setModels(models: GeneratedModel[]): void {
  modelLibrary.set({ models });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(models));
  } catch {
    // プライベートモードなどで localStorage が使えないことがある。
    // 保存できなくても、そのセッションのうちは動き続けられる
  }
}

/**
 * 保管庫を読み戻す。起動時に一度だけ、部屋と写真を読み戻したあとに呼ぶ。
 *
 * 保管庫ができる前に置いた生成家具は、置いた家具の側にしか記録が無い。
 * **保管庫の記録がまだ無い最初の起動でだけ**、それらを取り込む。
 * 毎回取り込むと、削除した家具が置いてある家具から復活してしまう
 */
export function restoreModelLibrary(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw === null) {
    setModels(importPlaced());
    return;
  }
  let saved: unknown = [];
  try {
    saved = JSON.parse(raw);
  } catch {
    saved = [];
  }
  modelLibrary.set({
    models: (Array.isArray(saved) ? saved : []).filter(isSavedModel).map(normalizeSaved),
  });
}

/** 置いてある生成家具を保管庫の項目にする。同じ GLB は 1 件にまとめる */
function importPlaced(): GeneratedModel[] {
  const models: GeneratedModel[] = [];
  const known = new Set<string>();
  for (const item of placedGenerated()) {
    const key = item.modelUrl ?? item.imageUrl;
    if (!key || known.has(key)) continue;
    known.add(key);
    models.push({
      id: crypto.randomUUID(),
      name: item.name ?? '写真から作った家具',
      modelKey: item.modelUrl ?? null,
      imageKey: item.imageUrl ?? null,
      previewKey: item.sourceImageKey ?? null,
      createdAt: 0,
    });
  }
  return models;
}

/** 切り抜きができる前の記録は imageKey を持たない。読み戻すときに null で埋める */
type SavedModel = Omit<GeneratedModel, 'imageKey'> & { imageKey?: string | null };

function isSavedModel(value: unknown): value is SavedModel {
  if (typeof value !== 'object' || value === null) return false;
  const model = value as Partial<SavedModel>;
  return (
    typeof model.id === 'string' &&
    (typeof model.modelKey === 'string' || typeof model.imageKey === 'string')
  );
}

function normalizeSaved(model: SavedModel): GeneratedModel {
  return { ...model, modelKey: model.modelKey ?? null, imageKey: model.imageKey ?? null };
}

export function addModel(model: GeneratedModel): void {
  setModels([...modelLibrary.get().models, model]);
}

/**
 * 名前かアイコンを変える。
 *
 * アイコンを差し替えたとき、前のプレビューがどこからも使われていなければ捨てる。
 * 名前は保管庫の項目だけを変える。置いてある家具への追随は renamePlacedCopies
 */
export function updateModel(
  id: string,
  patch: Partial<Pick<GeneratedModel, 'name' | 'previewKey'>>
): void {
  const model = modelLibrary.get().models.find((item) => item.id === id);
  if (!model) return;
  setModels(modelLibrary.get().models.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const previous = model.previewKey;
  if (patch.previewKey !== undefined && previous && previous !== patch.previewKey) {
    void releaseAssets({ previewKey: previous });
  }
}

/**
 * 置いてある同じ家具の名前をそろえる。
 *
 * 置いた家具は置いた時点の名前を写しているので、保管庫で名前を変えただけだと
 * 一覧と部屋で名前が食い違う。同じ中身を使っている家具を、両方のモードで書き換える
 */
export function renamePlacedCopies(model: GeneratedModel, name: string): void {
  for (const scene of [roomScene, photoScene]) {
    for (const item of scene.state().furniture) {
      if (isCopyOf(item, model) && item.name !== name) scene.update(item.id, { name });
    }
  }
}

/** 置いてある家具が、この保管庫の項目から置いたものか。中身のキーで見る */
function isCopyOf(item: PlacedFurniture, model: GeneratedModel): boolean {
  return (
    (model.modelKey !== null && item.modelUrl === model.modelKey) ||
    (model.imageKey !== null && item.imageUrl === model.imageKey)
  );
}

export function removeModel(id: string): void {
  const model = modelLibrary.get().models.find((item) => item.id === id);
  if (!model) return;
  setModels(modelLibrary.get().models.filter((item) => item.id !== id));
  void releaseAssets(model);
}

/**
 * 置いた生成家具を消したあとに呼ぶ。
 * 保管庫にも他の家具にも使われていなければ、中身を捨てる
 */
export function releaseFurnitureAssets(item: PlacedFurniture): void {
  if (!item.modelUrl && !item.imageUrl) return;
  void releaseAssets({
    modelKey: item.modelUrl ?? null,
    imageKey: item.imageUrl ?? null,
    previewKey: item.sourceImageKey ?? null,
  });
}

/** 捨てる候補。渡さなかった（undefined / null の）ものは見ない */
type Assets = Partial<Pick<GeneratedModel, 'modelKey' | 'imageKey' | 'previewKey'>>;

/** 保管庫からも置いた家具からも参照されなくなったものだけ捨てる */
async function releaseAssets({ modelKey, imageKey, previewKey }: Assets): Promise<void> {
  const models = modelLibrary.get().models;
  const placed = placedGenerated();
  const modelInUse =
    !modelKey ||
    models.some((m) => m.modelKey === modelKey) ||
    placed.some((f) => f.modelUrl === modelKey);
  const imageInUse =
    !imageKey ||
    models.some((m) => m.imageKey === imageKey) ||
    placed.some((f) => f.imageUrl === imageKey);
  const previewInUse =
    !previewKey ||
    models.some((m) => m.previewKey === previewKey) ||
    placed.some((f) => f.sourceImageKey === previewKey);

  try {
    if (modelKey && !modelInUse) await deleteModel(modelKey);
    if (imageKey && !imageInUse) await deleteCutout(imageKey);
    if (previewKey && !previewInUse) await deletePreview(previewKey);
  } catch {
    // 片付けに失敗しても、消す操作そのものは妨げない
  }
}

/** 部屋と写真に置いてある、写真から作った家具 */
function placedGenerated(): PlacedFurniture[] {
  return [...roomScene.state().furniture, ...photoScene.state().furniture].filter((item) =>
    Boolean(item.modelUrl || item.imageUrl)
  );
}

/** ファイル名から一覧に出す名前を作る。拡張子は要らない */
export function modelNameFrom(fileName: string): string {
  const name = fileName.replace(/\.[^.]+$/, '').trim();
  return name || '写真から作った家具';
}
