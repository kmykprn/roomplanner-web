/**
 * 写真モードの背景写真と、隠す場所のマスクと、奥行きと、一覧に出すアイコンを端末に残す。
 *
 * 写真は表示用に縮めた1枚（長辺 1600px、数百KB）、マスクは塗った形の PNG、
 * 奥行きは室内の寸法の計算で出した地図（560×420 の数値、約 1MB）、アイコンは画面の縮小（数十KB）。
 * localStorage には大きすぎるので IndexedDB に置く（生成のプレビューと同じ作り）。
 *
 * **保存した背景ごとに別に持つ。** 鍵は「背景の id/種類」（例: `a1b2/photo`）。
 * いま開いている背景の id は core/sceneLibrary.ts が setBackgroundScope で入れ、写真・マスク・奥行きの読み書きはその id の下で行う。
 * アイコンは一覧が全部の背景のぶんを読むので、id を渡す。
 * 保存した背景を持つ前の版は、固定の鍵（current / mask / depth）に 1 つだけ置いていた。最初の起動で id の下に移す（adoptLegacyBackground）
 */

import type { DepthMap } from '@/core/depthModel';

const DATABASE_NAME = 'roomplanner-photo-background';
const STORE_NAME = 'background';

type Item = 'photo' | 'mask' | 'depth' | 'thumb';
/** 保存した背景を持つ前の版の鍵 */
const LEGACY_KEYS: Record<Exclude<Item, 'thumb'>, string> = { photo: 'current', mask: 'mask', depth: 'depth' };

/** いま開いている背景の id。null は「保存した背景を持つ前の版の鍵」で読み書きする（id が決まる前の後方互換） */
let scope: string | null = null;
/** 前の版の鍵からの移し替え。終わるまで読み書きを待たせる */
let adoption: Promise<void> = Promise.resolve();

export function setBackgroundScope(id: string | null): void {
  scope = id;
}

function keyOf(item: Item, id: string | null = scope): string {
  if (id === null) {
    if (item === 'thumb') return 'thumb';
    return LEGACY_KEYS[item];
  }
  return `${id}/${item}`;
}

/**
 * 前の版の固定の鍵（current / mask / depth）にあるものを、背景 id の下へ移す。
 * 無ければ何もしない。終わるまで、ほかの読み書きは待つ
 */
export function adoptLegacyBackground(id: string): Promise<void> {
  adoption = (async () => {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    for (const item of ['photo', 'mask', 'depth'] as const) {
      const value = await requestResult<unknown>(store.get(LEGACY_KEYS[item]));
      if (value === undefined) continue;
      store.put(value, keyOf(item, id));
      store.delete(LEGACY_KEYS[item]);
    }
    await transactionDone(transaction);
    database.close();
  })().catch(() => {
    // 移せなくても起動は続ける。写真を選び直せばよい
  });
  return adoption;
}

export const saveBackground = (blob: Blob): Promise<void> => write(keyOf('photo'), blob);
export const readBackground = (): Promise<Blob | null> => read(keyOf('photo'));
export const deleteBackground = (): Promise<void> => remove(keyOf('photo'));

export const saveMask = (blob: Blob): Promise<void> => write(keyOf('mask'), blob);
export const readMask = (): Promise<Blob | null> => read(keyOf('mask'));
export const deleteMask = (): Promise<void> => remove(keyOf('mask'));

export const saveDepth = (depthMap: DepthMap): Promise<void> => write(keyOf('depth'), depthMap);
export const readDepth = async (): Promise<DepthMap | null> => {
  const value = await read<DepthMap>(keyOf('depth'));
  // 形が崩れていれば無かったことにする（計算し直せばよい）
  const valid =
    value && value.data instanceof Float32Array && value.width > 0 && value.height > 0 &&
    value.data.length === value.width * value.height;
  return valid ? value : null;
};
export const deleteDepth = (): Promise<void> => remove(keyOf('depth'));

/** 一覧に出すアイコン。背景も部屋も同じ置き場に入れる（部屋は写真を持たないが、アイコンは持つ） */
export const saveThumbnail = (id: string, blob: Blob): Promise<void> => write(keyOf('thumb', id), blob);
export const readThumbnail = (id: string): Promise<Blob | null> => read(keyOf('thumb', id));

/** ある id のものを全部（写真・マスク・奥行き・アイコン）別の id に写す。複製するとき */
export async function copyBackgroundData(from: string, to: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  for (const item of ['photo', 'mask', 'depth', 'thumb'] as const) {
    const value = await requestResult<unknown>(store.get(keyOf(item, from)));
    if (value !== undefined) store.put(value, keyOf(item, to));
  }
  await transactionDone(transaction);
  database.close();
}

/** ある id のものを全部消す。削除するとき */
export async function deleteBackgroundData(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  for (const item of ['photo', 'mask', 'depth', 'thumb'] as const) store.delete(keyOf(item, id));
  await transactionDone(transaction);
  database.close();
}

/** 値をそのまま残す。IndexedDB は Blob も数値の配列もそのまま入る */
async function write(key: string, value: Blob | DepthMap): Promise<void> {
  await adoption;
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).put(value, key);
  await transactionDone(transaction);
  database.close();
}

async function read<T = Blob>(key: string): Promise<T | null> {
  await adoption;
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const request = transaction.objectStore(STORE_NAME).get(key);
  const result = await requestResult<T | undefined>(request);
  await transactionDone(transaction);
  database.close();
  return result ?? null;
}

async function remove(key: string): Promise<void> {
  await adoption;
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).delete(key);
  await transactionDone(transaction);
  database.close();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}
