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

import { deleteAsset, resolveAssetUrl, saveAsset } from '@/platform/assetCache';

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
  await saveAsset(CACHE_NAME, key, await response.blob());
  return key;
}

/**
 * 保存した GLB を three.js が読める URL にして返す。
 *
 * GLTFLoader は URL しか受け取らないので、Blob から一時的なURLを作る。
 * 見つからなければ null（端末のデータが消された場合など）。
 *
 * **鍵の形では見分けない。** 生成した家具の鍵は `/generated/…`、サンプルの家具は
 * Vite が取り込んだ `/…/chair-abc123.glb` で、**どちらも `/` で始まる**。
 * 形で振り分けると生成した家具まで「そのまま読める URL」とみなし、
 * 端末に保存した中身を読まずに存在しないパスを取りに行く（仮の箱のまま残る）。
 * 先に保存庫を見て、無ければ URL として扱う。
 */
export async function resolveModelUrl(key: string): Promise<string | null> {
  const saved = await resolveAssetUrl(CACHE_NAME, key);
  if (saved) return saved;
  return isPlainUrl(key) ? key : null;
}

/** 端末の保存庫の鍵ではなく、そのまま読める URL か */
export function isPlainUrl(key: string): boolean {
  return /^(https?:|data:|\/|\.\/)/.test(key);
}

/** 家具を消したときに中身も捨てる。GLBは1件4〜5MBあるので溜めない */
export function deleteModel(key: string): Promise<void> {
  return deleteAsset(CACHE_NAME, key);
}
