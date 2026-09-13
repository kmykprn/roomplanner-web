/**
 * 保存してあるアイコンの画像を、要素の背景に出す。
 *
 * 作った家具のサムネイル・編集の姿のアイコン・置いてある家具の一覧、で同じものを使う。
 */

import { resolvePreview } from '@/platform/previewCache';

/** アイコンの画像を、キーが変わったときだけ読み直す。Blob URL は次の読み直しか dispose で解放する */
export function createPreviewImage(target: HTMLElement): { show(key: string | null): void; dispose(): void } {
  let shownKey: string | null | undefined;
  let url: string | null = null;
  let disposed = false;
  function release(): void {
    if (url) URL.revokeObjectURL(url);
    url = null;
    target.style.backgroundImage = '';
  }
  return {
    show(key) {
      if (key === shownKey) return;
      shownKey = key;
      release();
      if (!key) return;
      void resolvePreview(key).then((resolved) => {
        if (!resolved) return;
        // 待っている間に別のキーへ変わったか、捨てられたなら使わない
        if (disposed || shownKey !== key) {
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

