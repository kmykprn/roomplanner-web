/** 生成元写真の小さなプレビューを端末に保存する。 */

const DATABASE_NAME = 'roomplanner-generated-previews';
const STORE_NAME = 'previews';
const MAX_EDGE = 160;
const JPEG_QUALITY = 0.75;

export interface SavedPreview {
  key: string;
  url: string;
}

export function previewKey(id: string): string {
  return `preview-${id}`;
}

export interface PreviewOptions {
  /**
   * 下地の色。透過画像（切り抜き）を縮めるときに敷く。
   * JPEG は透過を持てないので、敷かないと透明な部分が黒く潰れる
   */
  background?: string;
}

/** 元画像を長辺160pxのJPEGにして保存する。読めない形式では何もしない。 */
export async function savePreview(
  id: string,
  file: Blob,
  options: PreviewOptions = {}
): Promise<SavedPreview | null> {
  const thumbnail = await createThumbnail(file, options);
  if (!thumbnail) return null;

  const key = previewKey(id);
  try {
    await writePreview(key, thumbnail);
    return { key, url: URL.createObjectURL(thumbnail) };
  } catch {
    return null;
  }
}

/** 保存済みプレビューを img に渡せる一時 URL として取り出す。 */
export async function resolvePreview(key: string): Promise<string | null> {
  try {
    const blob = await readPreview(key);
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

/** 家具または失敗した作成を消したときにプレビューも捨てる。 */
export async function deletePreview(key: string): Promise<void> {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(key);
    await transactionDone(transaction);
    database.close();
  } catch {
    // キャッシュの削除に失敗しても、家具の削除自体は妨げない
  }
}

async function createThumbnail(file: Blob, { background }: PreviewOptions): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    return null;
  }
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writePreview(key: string, blob: Blob): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).put(blob, key);
  await transactionDone(transaction);
  database.close();
}

async function readPreview(key: string): Promise<Blob | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const request = transaction.objectStore(STORE_NAME).get(key);
  const result = await requestResult<Blob | undefined>(request);
  await transactionDone(transaction);
  database.close();
  return result;
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