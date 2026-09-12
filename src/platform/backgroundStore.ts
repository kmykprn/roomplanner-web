/**
 * 写真モードの背景写真と、隠す場所のマスクを端末に残す。
 *
 * 写真は表示用に縮めた1枚（長辺 1600px、数百KB）、マスクは塗った形の PNG。
 * localStorage には大きすぎるので IndexedDB に置く（生成のプレビューと同じ作り）。
 * どちらも常に1枚だけなので、キーは固定。
 */

const DATABASE_NAME = 'roomplanner-photo-background';
const STORE_NAME = 'background';
const PHOTO_KEY = 'current';
const MASK_KEY = 'mask';

export const saveBackground = (blob: Blob): Promise<void> => write(PHOTO_KEY, blob);
export const readBackground = (): Promise<Blob | null> => read(PHOTO_KEY);
export const deleteBackground = (): Promise<void> => remove(PHOTO_KEY);

export const saveMask = (blob: Blob): Promise<void> => write(MASK_KEY, blob);
export const readMask = (): Promise<Blob | null> => read(MASK_KEY);
export const deleteMask = (): Promise<void> => remove(MASK_KEY);

async function write(key: string, blob: Blob): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).put(blob, key);
  await transactionDone(transaction);
  database.close();
}

async function read(key: string): Promise<Blob | null> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const request = transaction.objectStore(STORE_NAME).get(key);
  const result = await requestResult<Blob | undefined>(request);
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
