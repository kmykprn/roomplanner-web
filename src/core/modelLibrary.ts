/**
 * 写真から作った 3D モデルの保管庫。
 *
 * 作ったモデルは、置いた家具とは別に**ここに残る**。同じモデルを部屋にも写真にも、
 * 何度でも置けるようにするため。生成が終わっても勝手に置かず、ここに並ぶだけにする。
 *
 * 一覧そのものは localStorage に残す（数百バイト）。中身は大きいので別の場所にある。
 *   GLB … platform/modelCache.ts（Cache Storage）
 *   元写真の縮小プレビュー … platform/previewCache.ts（IndexedDB）
 *
 * GLB とプレビューは、保管庫の項目と置いた家具の両方から参照される。
 * どちらからも参照されなくなったときに捨てる（`releaseAssets`）。
 */

import { createStore } from '@/core/store';
import { roomScene } from '@/core/appState';
import { photoScene } from '@/core/photoState';
import { deleteModel } from '@/platform/modelCache';
import { deletePreview } from '@/platform/previewCache';
import type { PlacedFurniture } from '@/config/furniture';

const STORAGE_KEY = 'roomplanner.models';

/**
 * 生成したモデルの大きさ。
 *
 * 写真からは実寸が分からないので、いちばん長い辺が 1m に収まるようにする。
 * 縦横の比率はモデルのまま保たれる（modelLoader を参照）。
 */
export const GENERATED_SIZE: [number, number, number] = [1, 1, 1];

/** 生成したモデルの色。GLB が読めるまでの箱に使うだけ */
export const PLACEHOLDER_COLOR = '#bdb2a7';

export interface GeneratedModel {
  id: string;
  /** 一覧に出す名前。元写真のファイル名から拡張子を除いたもの */
  name: string;
  /** GLB の置き場（modelCache のキー） */
  modelKey: string;
  /** 元写真の縮小プレビュー（previewCache のキー）。作れなかったときは null */
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
 * 毎回取り込むと、× で外したモデルが置いてある家具から復活してしまう
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
  modelLibrary.set({ models: (Array.isArray(saved) ? saved : []).filter(isGeneratedModel) });
}

/** 置いてある生成家具を保管庫の項目にする。同じ GLB は 1 件にまとめる */
function importPlaced(): GeneratedModel[] {
  const models: GeneratedModel[] = [];
  const known = new Set<string>();
  for (const item of placedGenerated()) {
    if (!item.modelUrl || known.has(item.modelUrl)) continue;
    known.add(item.modelUrl);
    models.push({
      id: crypto.randomUUID(),
      name: item.name ?? '写真から作ったモデル',
      modelKey: item.modelUrl,
      previewKey: item.sourceImageKey ?? null,
      createdAt: 0,
    });
  }
  return models;
}

function isGeneratedModel(value: unknown): value is GeneratedModel {
  if (typeof value !== 'object' || value === null) return false;
  const model = value as Partial<GeneratedModel>;
  return typeof model.id === 'string' && typeof model.modelKey === 'string';
}

export function addModel(model: GeneratedModel): void {
  setModels([...modelLibrary.get().models, model]);
}

/**
 * 保管庫から外す。すでに置いてある家具はそのまま残る。
 * GLB とプレビューは、置いた家具からも使われていなければ捨てる
 */
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
    void releaseAssets(null, previous);
  }
}

/**
 * 置いてある同じモデルの名前をそろえる。
 *
 * 置いた家具は置いた時点の名前を写しているので、保管庫で名前を変えただけだと
 * 一覧と部屋で名前が食い違う。同じ GLB（modelKey）を使っている家具を、両方のモードで書き換える
 */
export function renamePlacedCopies(modelKey: string, name: string): void {
  for (const scene of [roomScene, photoScene]) {
    for (const item of scene.state().furniture) {
      if (item.modelUrl === modelKey && item.name !== name) scene.update(item.id, { name });
    }
  }
}

export function removeModel(id: string): void {
  const model = modelLibrary.get().models.find((item) => item.id === id);
  if (!model) return;
  setModels(modelLibrary.get().models.filter((item) => item.id !== id));
  void releaseAssets(model.modelKey, model.previewKey);
}

/**
 * 置いた生成家具を消したあとに呼ぶ。
 * 保管庫にも他の家具にも使われていなければ、GLB とプレビューを捨てる
 */
export function releaseFurnitureAssets(item: PlacedFurniture): void {
  if (!item.modelUrl) return;
  void releaseAssets(item.modelUrl, item.sourceImageKey ?? null);
}

/** 保管庫からも置いた家具からも参照されなくなったものだけ捨てる。modelKey が null なら GLB は見ない */
async function releaseAssets(modelKey: string | null, previewKey: string | null): Promise<void> {
  const models = modelLibrary.get().models;
  const placed = placedGenerated();
  const modelInUse =
    modelKey === null ||
    models.some((m) => m.modelKey === modelKey) ||
    placed.some((f) => f.modelUrl === modelKey);
  const previewInUse =
    previewKey !== null &&
    (models.some((m) => m.previewKey === previewKey) ||
      placed.some((f) => f.sourceImageKey === previewKey));

  try {
    if (modelKey !== null && !modelInUse) await deleteModel(modelKey);
    if (previewKey && !previewInUse) await deletePreview(previewKey);
  } catch {
    // 片付けに失敗しても、消す操作そのものは妨げない
  }
}

/** 部屋と写真に置いてある、写真から作った家具 */
function placedGenerated(): PlacedFurniture[] {
  return [...roomScene.state().furniture, ...photoScene.state().furniture].filter((item) =>
    Boolean(item.modelUrl)
  );
}

/** ファイル名から一覧に出す名前を作る。拡張子は要らない */
export function modelNameFrom(fileName: string): string {
  const name = fileName.replace(/\.[^.]+$/, '').trim();
  return name || '写真から作ったモデル';
}
