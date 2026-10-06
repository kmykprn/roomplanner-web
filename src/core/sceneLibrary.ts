/**
 * 保存した背景と部屋の一覧。
 *
 * 背景（写真に家具を置いたもの）と部屋（内装に家具を置いたもの）を何組も持ち、開くものを切り替える。
 * ここが持つのは**一覧（名前・種類・日時）と、いま開いているもの**だけ。
 * 中身（写真・家具・調整）は id ごとに別の場所にある。
 *
 *   一覧            … localStorage の STORAGE_KEY（JSON、数 KB）
 *   背景の中身      … localStorage の photoDataKey(id)（家具と調整）と IndexedDB（写真・マスク・奥行き。platform/backgroundStore.ts）
 *   部屋の中身      … localStorage の roomDataKey(id)（内装と家具）
 *   一覧のアイコン  … IndexedDB（背景も部屋も。backgroundStore の saveThumbnail）
 *
 * 中身の読み書きは core/persistence.ts が行う。開いているものを切り替えるとき、ここは id を変えて、
 * persistence が登録した読み込み（setSceneLoader）を呼ぶ。保存は persistence が「開いているものの id」をここから引いて行う。
 *
 * 保存した背景と部屋を持つ前の版は、背景と部屋を 1 つずつ固定の鍵に置いていた。一覧の記録がまだ無い最初の起動で、
 * それらを「背景 10/7」「部屋 10/7」のような名前で一覧に入れる（消えない）
 */

import { createStore } from '@/core/store';
import {
  adoptLegacyBackground,
  copyBackgroundData,
  deleteBackgroundData,
  readThumbnail,
  saveThumbnail,
  setBackgroundScope,
} from '@/platform/backgroundStore';

export type SceneKind = 'photo' | 'room';

export interface SceneEntry {
  id: string;
  kind: SceneKind;
  name: string;
  /** 作った日時（epoch ms） */
  createdAt: number;
  /** 最後に中身を保存した日時（epoch ms）。一覧はこの新しい順 */
  updatedAt: number;
}

export interface SceneLibraryState {
  entries: SceneEntry[];
  /** いま開いているもの。種類ごとに 1 つ。無ければ null（空の状態を編集している） */
  current: Record<SceneKind, string | null>;
}

const STORAGE_KEY = 'roomplanner.scenes';
/** 保存した背景と部屋を持つ前の版の鍵 */
export const LEGACY_PHOTO_KEY = 'roomplanner.photo';
export const LEGACY_ROOM_KEY = 'roomplanner.room';

export const photoDataKey = (id: string): string => `${LEGACY_PHOTO_KEY}.${id}`;
export const roomDataKey = (id: string): string => `${LEGACY_ROOM_KEY}.${id}`;

export const sceneLibrary = createStore<SceneLibraryState>({ entries: [], current: { photo: null, room: null } });

/** 種類ごとの、中身を読み込む関数。persistence.ts が起動時に登録する。null は「空にする」 */
type SceneLoader = (id: string | null) => void;
const loaders: Partial<Record<SceneKind, SceneLoader>> = {};

export function setSceneLoader(kind: SceneKind, loader: SceneLoader): void {
  loaders[kind] = loader;
}

/** 切り替える前に、溜まっている保存を書き出す関数。persistence.ts が登録する */
let flushSaves: () => void = () => {};

export function setSaveFlusher(flush: () => void): void {
  flushSaves = flush;
}

/** 一覧に出すアイコンを作る関数。main.ts が登録する（画面の描画が要る）。無ければアイコンは作らない */
let snapshotSource: ((kind: SceneKind) => Promise<Blob | null>) | null = null;

export function setSnapshotSource(source: (kind: SceneKind) => Promise<Blob | null>): void {
  snapshotSource = source;
}

/**
 * 一覧を読み戻す。**中身を読み戻す前に呼ぶ**（開いている id が決まってから中身を読む）。
 *
 * 一覧の記録がまだ無ければ、前の版の背景と部屋があるかを見て一覧に入れる。
 * 前の版の記録も無ければ（初めての起動）、一覧は空のまま
 */
export function restoreSceneLibrary(): void {
  const saved = readJson<Partial<SceneLibraryState>>(STORAGE_KEY);
  if (saved) {
    const entries = Array.isArray(saved.entries) ? saved.entries.filter(isEntry) : [];
    const current = saved.current ?? { photo: null, room: null };
    sceneLibrary.set({
      entries,
      current: {
        photo: entries.some((entry) => entry.kind === 'photo' && entry.id === current.photo) ? current.photo : null,
        room: entries.some((entry) => entry.kind === 'room' && entry.id === current.room) ? current.room : null,
      },
    });
    setBackgroundScope(sceneLibrary.get().current.photo);
    ensureCurrent();
    return;
  }
  migrateLegacy();
  ensureCurrent();
}

/**
 * 開いているものが無い種類には、新しいものを作って開いておく。
 * 初めての起動（一覧が空）では、新しい背景を開いた状態から始める。
 * 中身を残す側（persistence.ts）は開いている id の鍵に書くので、id が無いと何も残らない
 */
function ensureCurrent(): void {
  for (const kind of ['photo', 'room'] as const) {
    if (sceneLibrary.get().current[kind]) continue;
    const entry = newEntry(kind, defaultName(kind), Date.now());
    sceneLibrary.set((state) => ({ entries: [...state.entries, entry], current: { ...state.current, [kind]: entry.id } }));
    if (kind === 'photo') setBackgroundScope(entry.id);
  }
  persist();
}

/** 前の版の背景と部屋（固定の鍵に 1 つずつ）を一覧に入れる。中身の鍵を id 付きの鍵に移す */
function migrateLegacy(): void {
  const now = Date.now();
  const entries: SceneEntry[] = [];
  const current: SceneLibraryState['current'] = { photo: null, room: null };
  for (const kind of ['photo', 'room'] as const) {
    const legacyKey = kind === 'photo' ? LEGACY_PHOTO_KEY : LEGACY_ROOM_KEY;
    const raw = readRaw(legacyKey);
    if (raw === null) continue;
    const entry = newEntry(kind, defaultName(kind, now), now);
    entries.push(entry);
    current[kind] = entry.id;
    try {
      localStorage.setItem(kind === 'photo' ? photoDataKey(entry.id) : roomDataKey(entry.id), raw);
      localStorage.removeItem(legacyKey);
    } catch {
      // 書けなければ前の版の鍵のまま。次の起動でまた試す
    }
    if (kind === 'photo') void adoptLegacyBackground(entry.id);
  }
  sceneLibrary.set({ entries, current });
  setBackgroundScope(current.photo);
  if (entries.length > 0) persist();
}

export function entriesOf(kind: SceneKind): SceneEntry[] {
  return sceneLibrary
    .get()
    .entries.filter((entry) => entry.kind === kind)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function sceneById(id: string): SceneEntry | null {
  return sceneLibrary.get().entries.find((entry) => entry.id === id) ?? null;
}

export function currentScene(kind: SceneKind): SceneEntry | null {
  const id = sceneLibrary.get().current[kind];
  return id ? sceneById(id) : null;
}

/** 新しい名前の既定。「背景 10/7」「部屋 10/7」 */
export function defaultName(kind: SceneKind, at = Date.now()): string {
  const date = new Date(at);
  return `${kind === 'photo' ? '背景' : '部屋'} ${date.getMonth() + 1}/${date.getDate()}`;
}

/** 新しく作る。一覧に入れるだけで、開かない（開くのは openScene） */
export function createScene(kind: SceneKind, name = defaultName(kind)): SceneEntry {
  const entry = newEntry(kind, name, Date.now());
  sceneLibrary.set((state) => ({ entries: [...state.entries, entry] }));
  persist();
  return entry;
}

/**
 * 開く。同じ種類で開いていたものの保存を書き出してから、id を切り替えて中身を読み込む。
 * 無い id なら何もしない
 */
export function openScene(id: string): void {
  const entry = sceneById(id);
  if (!entry) return;
  if (sceneLibrary.get().current[entry.kind] === id) return;
  flushSaves();
  switchTo(entry.kind, id);
}

/** 開いているものを無くして、空の状態にする（最後の 1 つを消したとき） */
function switchTo(kind: SceneKind, id: string | null): void {
  sceneLibrary.set((state) => ({ current: { ...state.current, [kind]: id } }));
  if (kind === 'photo') setBackgroundScope(id);
  persist();
  loaders[kind]?.(id);
}

export function renameScene(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  sceneLibrary.set((state) => ({
    entries: state.entries.map((entry) => (entry.id === id ? { ...entry, name: trimmed } : entry)),
  }));
  persist();
}

/** 中身を保存したときに呼ぶ。一覧の並び（新しい順）に使う */
export function touchScene(id: string): void {
  const now = Date.now();
  sceneLibrary.set((state) => ({
    entries: state.entries.map((entry) => (entry.id === id ? { ...entry, updatedAt: now } : entry)),
  }));
  persist();
}

/**
 * 複製する。中身（localStorage の記録と、背景なら写真・マスク・奥行き・アイコン）を写し、
 * 「〜のコピー」の名前で一覧に入れる。開くのは呼ぶ側（openScene）
 */
export async function duplicateScene(id: string): Promise<SceneEntry | null> {
  const source = sceneById(id);
  if (!source) return null;
  // 開いているものなら、溜まっている保存を先に書き出す（写す元を最新にする）
  if (sceneLibrary.get().current[source.kind] === id) flushSaves();
  const copy = createScene(source.kind, `${source.name} のコピー`);
  const dataKey = source.kind === 'photo' ? photoDataKey : roomDataKey;
  const raw = readRaw(dataKey(id));
  if (raw !== null) {
    try {
      localStorage.setItem(dataKey(copy.id), raw);
    } catch {
      // 容量超過。中身の無いコピーになるが、一覧には残る
    }
  }
  await copyBackgroundData(id, copy.id).catch(() => {});
  return copy;
}

/**
 * 削除する。中身も消す。開いているものを消したら、同じ種類の残りで一番新しいものを開く（無ければ空にする）
 */
export async function deleteScenes(ids: string[]): Promise<void> {
  const removing = new Set(ids);
  const victims = sceneLibrary.get().entries.filter((entry) => removing.has(entry.id));
  if (victims.length === 0) return;
  sceneLibrary.set((state) => ({ entries: state.entries.filter((entry) => !removing.has(entry.id)) }));
  for (const victim of victims) {
    try {
      localStorage.removeItem(victim.kind === 'photo' ? photoDataKey(victim.id) : roomDataKey(victim.id));
    } catch {
      // 消せなくても一覧からは消えている
    }
  }
  for (const kind of ['photo', 'room'] as const) {
    const current = sceneLibrary.get().current[kind];
    if (current && removing.has(current)) switchTo(kind, entriesOf(kind)[0]?.id ?? null);
  }
  persist();
  await Promise.all(victims.map((victim) => deleteBackgroundData(victim.id).catch(() => {})));
}

/** 一覧に出すアイコンを、いまの画面から作って残す。開いているものにだけ使える */
export async function snapshotScene(id: string): Promise<void> {
  const entry = sceneById(id);
  if (!entry || !snapshotSource || sceneLibrary.get().current[entry.kind] !== id) return;
  const blob = await snapshotSource(entry.kind).catch(() => null);
  if (!blob) return;
  await saveThumbnail(id, blob).catch(() => {});
}

export function readSceneThumbnail(id: string): Promise<Blob | null> {
  return readThumbnail(id).catch(() => null);
}

function newEntry(kind: SceneKind, name: string, at: number): SceneEntry {
  return { id: crypto.randomUUID(), kind, name, createdAt: at, updatedAt: at };
}

function isEntry(value: unknown): value is SceneEntry {
  const entry = value as Partial<SceneEntry> | null;
  return (
    !!entry &&
    typeof entry.id === 'string' &&
    (entry.kind === 'photo' || entry.kind === 'room') &&
    typeof entry.name === 'string' &&
    typeof entry.createdAt === 'number' &&
    typeof entry.updatedAt === 'number'
  );
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sceneLibrary.get()));
  } catch {
    // 容量超過やプライベートモード。保存できなくても、そのセッションのうちは動く
  }
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 壊れた値が入っていても起動できなくならないよう、読めなければ null にする */
function readJson<T>(key: string): T | null {
  const raw = readRaw(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
