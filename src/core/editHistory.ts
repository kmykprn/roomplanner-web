/**
 * 置いた家具の操作の履歴（操作タブの「ひとつ戻す」）。
 *
 * **指で触れてから離すまでを 1 回の操作とする。** 触り始めたときの家具の一覧を控え（beginEdit）、
 * 離したときに変わっていれば履歴に積む（endEdit）。バーを動かしている間や、家具をドラッグしている
 * 間に何十回も状態が変わっても、戻すときは触る前の 1 か所に戻る。
 *
 * 履歴は部屋と写真で別々に持つ（置き場ごと）。写真を替えたら、その写真の履歴は捨てる。
 * 端末には残さない（開き直すと消える）。
 *
 * 画面から削除した家具の中身（3D や切り抜き）は、戻せる間は捨てない。
 * 捨てるのは、その操作が履歴から押し出されたか、履歴ごと捨てたとき（onDiscard）。
 */

import type { PlacedFurniture } from '@/config/furniture';
import type { EditableScene } from '@/core/furnitureScene';
import { createStore } from '@/core/store';

/** 戻せる回数の上限。古いものから捨てる */
const LIMIT = 50;

interface Entry {
  /** 操作の前の家具の一覧 */
  before: PlacedFurniture[];
  /** この操作が戻せなくなったときにすること（削除した家具の中身を捨てる、など） */
  onDiscard: (() => void)[];
}

interface Pending {
  before: PlacedFurniture[];
  onDiscard: (() => void)[];
}

const stacks = new Map<EditableScene, Entry[]>();
const pending = new Map<EditableScene, Pending>();

/** 履歴が変わったことを画面に知らせる（戻せるかどうかの表示を描き直す） */
export const editHistory = createStore<{ version: number }>({ version: 0 });

/**
 * 指で触っている途中か（どれかの置き場で beginEdit してから endEdit するまで）。
 * 端末への保存は、これが終わるまで待ってまとめて 1 回にする（persistence.ts）
 */
export const editSession = createStore<{ editing: boolean }>({ editing: false });

function syncEditing(): void {
  const editing = pending.size > 0;
  if (editSession.get().editing !== editing) editSession.set({ editing });
}

function changed(): void {
  editHistory.set({ version: editHistory.get().version + 1 });
}

function copyOf(furniture: PlacedFurniture[]): PlacedFurniture[] {
  return JSON.parse(JSON.stringify(furniture)) as PlacedFurniture[];
}

/** 操作を始める。すでに始めていれば何もしない（最初に触ったときの姿を控えておく） */
export function beginEdit(scene: EditableScene): void {
  if (!pending.has(scene)) pending.set(scene, { before: copyOf(scene.state().furniture), onDiscard: [] });
  syncEditing();
}

/**
 * 戻せなくなったときにすることを、いまの操作に添える（画面から削除した家具の中身を捨てる、など）。
 * 操作を始めていなければ、すぐにする
 */
export function discardLater(scene: EditableScene, task: () => void): void {
  const current = pending.get(scene);
  if (current) current.onDiscard.push(task);
  else task();
}

/** 操作を終える。触る前から変わっていれば履歴に積む。変わっていなければ（タップだけ など）何も残さない */
export function endEdit(scene: EditableScene): void {
  const current = pending.get(scene);
  if (!current) return;
  pending.delete(scene);
  syncEditing();
  if (JSON.stringify(current.before) === JSON.stringify(scene.state().furniture)) {
    current.onDiscard.forEach((task) => task());
    return;
  }
  const stack = stacks.get(scene) ?? [];
  stack.push({ before: current.before, onDiscard: current.onDiscard });
  // 上限を超えたら古いものから捨てる。捨てた操作はもう戻せないので、後始末をする
  while (stack.length > LIMIT) stack.shift()?.onDiscard.forEach((task) => task());
  stacks.set(scene, stack);
  changed();
}

/** 始めてすぐ終わる操作（ボタン 1 回）を履歴に積む */
export function recordEdit(scene: EditableScene, apply: () => void): void {
  beginEdit(scene);
  apply();
  endEdit(scene);
}

export function canUndo(scene: EditableScene): boolean {
  return (stacks.get(scene)?.length ?? 0) > 0;
}

/** ひとつ前の操作の前の姿に戻す。選んでいた家具が戻した一覧に無ければ、選択を外す */
export function undo(scene: EditableScene): void {
  const entry = stacks.get(scene)?.pop();
  if (!entry) return;
  const { selectedId } = scene.state();
  scene.restore(entry.before);
  if (selectedId && !entry.before.some((item) => item.id === selectedId)) scene.select(null);
  changed();
}

/** 履歴をすべて捨てる（写真を替えたとき）。戻せなくなるので、後始末をする */
export function clearHistory(scene: EditableScene): void {
  stacks.get(scene)?.forEach((entry) => entry.onDiscard.forEach((task) => task()));
  stacks.delete(scene);
  pending.delete(scene);
  syncEditing();
  changed();
}
