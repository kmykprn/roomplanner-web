/**
 * 写真から切り抜いた透過 PNG を端末に残す。
 *
 * 切り抜きは数秒でできるが、サーバーは結果を持たない（同期で返して終わり）。
 * 置いた家具が次に開いたときも出るように、中身をここに置く。
 * 1 件 100KB〜1MB。GLB（modelCache.ts）と同じ作りで、キャッシュ名だけ分ける
 */

import { deleteAsset, resolveAssetUrl, saveAsset } from '@/platform/assetCache';

const CACHE_NAME = 'generated-cutouts';

/** 保管庫と置いた家具が持つキー。URL の形にしておくと Cache Storage がそのまま扱える */
export function cutoutKey(id: string): string {
  return `/cutouts/${id}.png`;
}

export async function saveCutout(id: string, png: Blob): Promise<string> {
  const key = cutoutKey(id);
  await saveAsset(CACHE_NAME, key, png);
  return key;
}

/** 保存した切り抜きを three.js の TextureLoader や img が読める URL にして返す */
export function resolveCutoutUrl(key: string): Promise<string | null> {
  return resolveAssetUrl(CACHE_NAME, key);
}

export function deleteCutout(key: string): Promise<void> {
  return deleteAsset(CACHE_NAME, key);
}
