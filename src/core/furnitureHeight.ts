/**
 * 家具の「実際の高さ」。
 *
 * 写真から作った家具には長さの情報が無いので、いちばん長い辺を 1 m にして置いていた。
 * 部屋の写真の中の物と比べると、これでは机や棚が小さく見える。
 * 利用者に実際の高さを 1 つ入れてもらい、それに合わせて置く。
 *
 * 高さ 1 つで足りるのは、切り抜きも 3D モデルも縦横の比率をすでに持っているから。
 * その比率（形）は中身を読み込んだときに測って、保管庫の項目に覚えさせる（learnShape）。
 *
 * 置いてある家具の「大きさ」のバーは「置いたときの何倍か」で動くので、
 * 実際の高さは「置いたときの大きさ（baseSize）」の高さとして持つ。
 */

import type { PlacedFurniture } from '@/config/furniture';
import type { EditableScene } from '@/core/furnitureScene';
import { roomScene } from '@/core/appState';
import { photoScene } from '@/core/photoState';
import {
  GENERATED_SIZE,
  isCopyOf,
  modelFor,
  modelLibrary,
  updateModel,
  type GeneratedModel,
  type ModelFacet,
} from '@/core/modelLibrary';

type Size = [number, number, number];

/** 実際の高さとして受け付ける範囲（m）。小物から大型の棚まで */
export const REAL_HEIGHT_LIMITS = { min: 0.05, max: 5 };

function longestOf(size: Size): number {
  return Math.max(...size);
}

function scaled(size: Size, factor: number): Size {
  return [size[0] * factor, size[1] * factor, size[2] * factor];
}

/** 3 辺の比率を保ったまま、高さをこの値にする */
function withHeight(size: Size, height: number): Size {
  return scaled(size, height / size[1]);
}

function clampHeight(height: number): number {
  return Math.min(REAL_HEIGHT_LIMITS.max, Math.max(REAL_HEIGHT_LIMITS.min, height));
}

/**
 * 項目の実際の高さ（m）。利用者が入れた値、無ければ商品ページ（サンプル）の寸法の高さ。
 * どちらも無ければ undefined（いちばん長い辺 1 m で置く）
 */
export function realHeightOf(model: GeneratedModel): number | undefined {
  return model.height ?? model.size?.[1];
}

/**
 * 保管庫の項目を置くときの大きさ。
 *
 * 形は、測ってあればそれ（中身の 3 辺の比率）、無ければ商品ページの寸法、
 * それも無ければ 1 m の立方体（読み込めたときに締まる）。
 * 実際の高さが分かっていれば、比率を保ってその高さにする。
 * **商品の寸法があっても、測った形を優先する。** 寸法の箱に収めると、箱と中身の比率が
 * 違う分だけ中身が小さくなる（サンプルの椅子は 0.9 m の箱で 0.77 m にしかならなかった）
 */
export function placementSize(model: GeneratedModel, facet: ModelFacet): Size {
  const shape = model.shape?.[facet];
  const base: Size = shape ? [...shape] : model.size ? [...model.size] : [...GENERATED_SIZE];
  const height = realHeightOf(model);
  return height ? withHeight(base, height) : base;
}

/** 置いてある家具の実際の高さ（m）。バーで何倍にしていても変わらない */
export function baseHeightOf(item: PlacedFurniture): number {
  return (item.baseSize ?? item.size)[1];
}

/**
 * 置いてある家具の実際の高さを変える。
 *
 * 保管庫の項目から置いたものなら、項目にも書き戻し、同じ家具の他の置き分もそろえる
 * （次に置くときからこの高さになる）。項目が無ければ、この家具だけ変える
 */
export function setPlacedHeight(scene: EditableScene, id: string, height: number): void {
  const item = scene.state().furniture.find((entry) => entry.id === id);
  if (!item) return;
  const model = modelFor(item);
  if (model) setModelHeight(model.id, height);
  else applyHeight(scene, item, clampHeight(height));
}

/** 保管庫の項目の実際の高さを変え、置いてある同じ家具もすべてその高さにする */
export function setModelHeight(modelId: string, height: number): void {
  const model = modelLibrary.get().models.find((entry) => entry.id === modelId);
  if (!model) return;
  const clamped = clampHeight(height);
  updateModel(modelId, { height: clamped });
  for (const scene of [roomScene, photoScene]) {
    for (const item of scene.state().furniture) {
      if (isCopyOf(item, model)) applyHeight(scene, item, clamped);
    }
  }
}

/** 置いたときの大きさの高さを変え、いまの倍率はそのまま保つ */
function applyHeight(scene: EditableScene, item: PlacedFurniture, height: number): void {
  const base = item.baseSize ?? item.size;
  const ratio = longestOf(item.size) / longestOf(base);
  const nextBase = withHeight(base, height);
  const size = scaled(nextBase, ratio);
  scene.update(item.id, {
    baseSize: nextBase,
    size,
    position: scene.constrain(item.position, size, item.rotationY),
  });
}

/**
 * 読み込めた中身の実際の形を覚える。
 *
 * @param bounds いま画面に出ている中身の外形（m）。箱に収めたあとの実測
 *
 * 置いてある家具の箱は、中身の形に締める。見た目は変えない。
 * ただし実際の高さが決まっている項目なら、中身の高さがその値になるよう大きさを直す
 * （箱が 1 m の立方体のままだと「いちばん長い辺 = 高さ」になり、机の高さが合わない）。
 * 形は保管庫の項目にも覚えさせ、次に置くときは最初から締まった箱で置く
 */
export function learnShape(scene: EditableScene, id: string, bounds: Size): void {
  const item = scene.state().furniture.find((entry) => entry.id === id);
  if (!item || longestOf(bounds) <= 0) return;
  const shape = scaled(bounds, 1 / longestOf(bounds));
  const model = modelFor(item);
  const facet: ModelFacet = item.modelUrl ? 'solid' : 'flat';
  if (model && !model.shape?.[facet]) {
    updateModel(model.id, { shape: { ...model.shape, [facet]: shape } });
  }

  const base = item.baseSize ?? item.size;
  const ratio = longestOf(item.size) / longestOf(base);
  const height = model ? realHeightOf(model) : undefined;
  const nextBase = height ? withHeight(shape, height) : scaled(bounds, 1 / ratio);
  const size = scaled(nextBase, ratio);
  // 読み戻すたびに呼ばれる。すでに締まっていれば書き換えない（保存と再描画を省く）
  if (size.every((edge, axis) => Math.abs(edge - item.size[axis]) < 1e-4)) return;
  scene.update(item.id, {
    baseSize: nextBase,
    size,
    position: scene.constrain(item.position, size, item.rotationY),
  });
}
