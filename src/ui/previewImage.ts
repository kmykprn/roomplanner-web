/**
 * 家具のアイコンの画像を、要素の背景に出す。
 *
 * 作った家具のサムネイル・編集の姿のアイコン・置いてある家具の一覧、で同じものを使う。
 *
 * **切り抜いた画像があれば、そちらを使う。** アイコンの縮小画像は家具を作るときに撮った写真そのもので、
 * 家具が写真の端にあると枠の中で見切れた。切り抜きは背景が消えて家具だけなので、枠の真ん中に収まる。
 * どちらの画像も、枠を覆わず全体を収めて出す（style.css の .thumb__img・.manage__icon）。
 */

import { resolveCutoutUrl } from '@/platform/cutoutCache';
import { resolvePreview } from '@/platform/previewCache';

/** アイコンの画像のありか。切り抜き（cutoutCache のキー）があればそれ、無ければ縮小画像（previewCache のキー） */
export interface IconSource {
  cutoutKey?: string | null;
  previewKey?: string | null;
}

/** 切り抜き、無ければ縮小画像を、一時 URL にして返す。どちらも無ければ null */
async function resolveIcon(source: IconSource): Promise<string | null> {
  if (source.cutoutKey) {
    const cutout = await resolveCutoutUrl(source.cutoutKey).catch(() => null);
    if (cutout) return cutout;
  }
  return source.previewKey ? resolvePreview(source.previewKey) : null;
}

/** アイコンの画像を、ありかが変わったときだけ読み直す。Blob URL は次の読み直しか dispose で解放する */
export function createPreviewImage(target: HTMLElement): { show(source: IconSource): void; dispose(): void } {
  let shownId: string | undefined;
  let url: string | null = null;
  let disposed = false;
  function release(): void {
    if (url) URL.revokeObjectURL(url);
    url = null;
    target.style.backgroundImage = '';
  }
  return {
    show(source) {
      const id = `${source.cutoutKey ?? ''}|${source.previewKey ?? ''}`;
      if (id === shownId) return;
      shownId = id;
      release();
      if (!source.cutoutKey && !source.previewKey) return;
      void resolveIcon(source).then((resolved) => {
        if (!resolved) return;
        // 待っている間に別のアイコンへ変わったか、捨てられたなら使わない
        if (disposed || shownId !== id) {
          URL.revokeObjectURL(resolved);
          return;
        }
        url = resolved;
        target.style.backgroundImage = `url("${resolved}")`;
      });
    },
    dispose() {
      disposed = true;
      release();
    },
  };
}
