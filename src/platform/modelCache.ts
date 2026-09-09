/**
 * 生成した GLB を端末に残す。
 *
 * 生成には8分以上かかるので、リロードで消えてよいものではない。
 * また、サーバーが返す署名付きURLは1時間で切れるため、URLを覚えておくだけでは
 * あとから読めなくなる。**中身を保存する必要がある。**
 *
 * ## Service Worker のキャッシュに任せない理由
 *
 * vite.config.ts に `urlPattern: /\.glb$/` の CacheFirst があるが、
 * 署名付きURLは末尾にクエリが付くのでこの正規表現に一致しない。
 * かつURLが毎回変わるので、URLをキーにしたキャッシュとは相性が悪い。
 * そこで jobId から作った**変わらないキー**で自分で入れる。
 */

const CACHE_NAME = 'generated-models';

/** appState に保存するキー。URLの形にしておくと Cache Storage がそのまま扱える */
export function modelKey(jobId: string): string {
  return `/generated/${jobId}.glb`;
}

/** 署名付きURLから中身を取ってきて保存する。URLが切れる前に済ませる */
export async function saveModel(jobId: string, signedUrl: string): Promise<string> {
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new Error(`生成物を取得できませんでした (${response.status})`);
  }
  const key = modelKey(jobId);
  const cache = await caches.open(CACHE_NAME);
  // Response は一度読むと使えないので、保存用に複製してから渡す
  await cache.put(key, new Response(await response.blob()));
  return key;
}

/**
 * 保存した GLB を three.js が読める URL にして返す。
 *
 * GLTFLoader は URL しか受け取らないので、Blob から一時的なURLを作る。
 * 見つからなければ null（端末のデータが消された場合など）。
 */
export async function resolveModelUrl(key: string): Promise<string | null> {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(key);
  if (!hit) return null;
  return URL.createObjectURL(await hit.blob());
}

/** 家具を消したときに中身も捨てる。GLBは1件4〜5MBあるので溜めない */
export async function deleteModel(key: string): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(key);
}
