/**
 * 写真モードの背景写真と、隠す場所のマスクを端末に残す。
 *
 * 写真は表示用に縮めた1枚（長辺 1600px、数百KB）、マスクは塗った形の PNG、
 * 奥行きは室内の寸法の計算で出した地図（560×420 の数値、約 1MB）。
 * localStorage には大きすぎるので IndexedDB に置く（生成のプレビューと同じ作り）。
 * どれも常に1つだけなので、キーは固定。
 */

import type { DepthMap } from '@/core/depthModel';

const DATABASE_NAME = 'roomplanner-photo-background';
const STORE_NAME = 'background';
const PHOTO_KEY = 'current';
const MASK_KEY = 'mask';
const DEPTH_KEY = 'depth';

export const saveBackground = (blob: Blob): Promise<void> => write(PHOTO_KEY, blob);
export const readBackground = (): Promise<Blob | null> => read(PHOTO_KEY);
export const deleteBackground = (): Promise<void> => remove(PHOTO_KEY);

export const saveMask = (blob: Blob): Promise<void> => write(MASK_KEY, blob);
export const readMask = (): Promise<Blob | null> => read(MASK_KEY);
export const deleteMask = (): Promise<void> => remove(MASK_KEY);

export const saveDepth = (depthMap: DepthMap): Promise<void> => write(DEPTH_KEY, depthMap);
export const readDepth = async (): Promise<DepthMap | null> => {
  const value = await read<DepthMap>(DEPTH_KEY);
  // 形が崩れていれば無かったことにする（計算し直せばよい）
  const valid =
    value && value.data instanceof Float32Array && value.width > 0 && value.height > 0 &&
    value.data.length === value.width * value.height;
  return valid ? value : null;
};
export const deleteDepth = (): Promise<void> => remove(DEPTH_KEY);

/** 値をそのまま残す。IndexedDB は Blob も数値の配列もそのまま入る */
async function write(key: string, value: Blob | DepthMap): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).put(value, key);
  await transactionDone(transaction);
  database.close();
}

async function read<T = Blob>(key: string): Promise<T | null> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const request = transaction.objectStore(STORE_NAME).get(key);
  const result = await requestResult<T | undefined>(request);
  await transactionDone(transaction);
  database.close();
  return result ?? null;
}

async function remove(key: string): Promise<void> {
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
