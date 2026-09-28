/**
 * 写真から切り抜いた透過 PNG を端末に残す。
 *
 * 切り抜きは数秒でできるが、サーバーは結果を持たない（同期で返して終わり）。
 * 置いた家具が次に開いたときも出るように、中身をここに置く。
 * 1 件 100KB〜1MB。GLB（modelCache.ts）と同じ作りで、キャッシュ名だけ分ける
 */

import { deleteAsset, resolveAssetUrl, saveAsset, readAsset } from '@/platform/assetCache';
import { isPlainUrl } from '@/platform/modelCache';

const CACHE_NAME = 'generated-cutouts';

/** 保管庫と置いた家具が持つキー。URL の形にしておくと Cache Storage がそのまま扱える */
export function cutoutKey(id: string): string {
  return `/cutouts/${id}.png`;
}

/**
 * アプリに同梱した画像の URL か（サンプルの 2D。config/samples.ts）。
 * 端末に残した切り抜きのキー（/cutouts/…）も URL の形なので、それとは分けて見る
 */
function isBundled(key: string): boolean {
  return isPlainUrl(key) && !key.startsWith('/cutouts/');
}

export async function saveCutout(id: string, png: Blob): Promise<string> {
  const key = cutoutKey(id);
  await saveAsset(CACHE_NAME, key, png);
  return key;
}

/** 保存した切り抜きを three.js の TextureLoader や img が読める URL にして返す。同梱の画像は URL のまま */
export function resolveCutoutUrl(key: string): Promise<string | null> {
  if (isBundled(key)) return Promise.resolve(key);
  return resolveAssetUrl(CACHE_NAME, key);
}

/** 保存した切り抜きを Blob で返す。3D モデルの入力に送り直すとき用。同梱の画像は読み込んで返す */
export async function readCutout(key: string): Promise<Blob | null> {
  if (isBundled(key)) {
    const response = await fetch(key).catch(() => null);
    return response?.ok ? response.blob() : null;
  }
  return readAsset(CACHE_NAME, key);
}

/** 捨てる。同梱の画像はアプリの一部なので何もしない */
export function deleteCutout(key: string): Promise<void> {
  if (isBundled(key)) return Promise.resolve();
  return deleteAsset(CACHE_NAME, key);
}
