/**
 * 大きなファイル（GLB・切り抜き PNG）を端末に残す共通部分。
 *
 * 置き場は Cache Storage。localStorage は数 MB で頭打ちになるうえ文字列しか持てない。
 * IndexedDB でもよいが、Cache Storage は「URL のような文字列 → Response」の
 * 素朴な入れ物で、Blob を出し入れするだけならこちらのほうが短く書ける。
 *
 * 用途ごとにキャッシュ名を分ける（modelCache.ts / cutoutCache.ts）。
 * 混ぜると、片方を丸ごと捨てたいときに区別できない
 */

export async function saveAsset(cacheName: string, key: string, blob: Blob): Promise<void> {
  const cache = await caches.open(cacheName);
  await cache.put(key, new Response(blob));
}

/**
 * 保存したものを、img や three.js が読める URL にして返す。
 * 見つからなければ null（端末のデータが消された場合など）。
 * 使い終わったら URL.revokeObjectURL で解放する
 */
export async function resolveAssetUrl(cacheName: string, key: string): Promise<string | null> {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(key);
  if (!hit) return null;
  return URL.createObjectURL(await hit.blob());
}

export async function deleteAsset(cacheName: string, key: string): Promise<void> {
  const cache = await caches.open(cacheName);
  await cache.delete(key);
}
