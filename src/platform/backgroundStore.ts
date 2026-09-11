/**
 * 写真モードの背景写真を端末に残す。
 *
 * 表示用に縮めた1枚（長辺 1600px の JPEG、数百KB）だけを持つ。
 * localStorage には大きすぎるので IndexedDB に置く（生成のプレビューと同じ作り）。
 * 常に1枚だけなので、キーは固定。
 */

const DATABASE_NAME = 'roomplanner-photo-background';
const STORE_NAME = 'background';
const KEY = 'current';

export async function saveBackground(blob: Blob): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).put(blob, KEY);
  await transactionDone(transaction);
  database.close();
}

export async function readBackground(): Promise<Blob | null> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const request = transaction.objectStore(STORE_NAME).get(KEY);
  const result = await requestResult<Blob | undefined>(request);
  await transactionDone(transaction);
  database.close();
  return result ?? null;
}

export async function deleteBackground(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).delete(KEY);
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
