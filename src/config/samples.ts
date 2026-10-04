/**
 * 最初から保管庫に入っている家具（サンプル）。
 *
 * 初回起動時に一度だけ保管庫に入れる（core/modelLibrary.ts）。作った家具と同じ扱いなので、
 * 名前を変えたり消したりできる。消したら次回も復活しない。
 *
 * 元の画像は自前で作ったもの: 画像生成（SDXL）で「白背景の商品写真」風の画像を作った（assets-src/furniture/inputs/）。
 * 第三者の写真・意匠は使っていない（作り方は README「サンプルの家具について」）。
 * **2D と 3D は、利用者が作るのと同じアプリの流れで作った。** 元の画像をアプリの「2D（切り抜き）を作る」に通し
 * （切り抜きのサービス）、できた 2D から「3D モデルを作る」（いまの既定の作り方、TRELLIS）で 3D にした。
 * 前は 3D を別の作り方（Hunyuan3D）で作っていて、写真よりずっと鮮やかなオレンジになり、2D と別の物に見えた。
 * アイコンは 3D を描いたもの。
 *
 * GLB と画像は Vite に取り込ませ、ファイル名に内容のハッシュを付ける。端末は一度使った
 * モデルを保存して次からはそれを使う（vite.config.ts の runtimeCaching）ので、
 * 同じ名前のまま中身を差し替えると古い方が出続ける
 */

import chairModel from '@/assets/furniture/chair.glb?url';
import chairThumb from '@/assets/furniture/chair.webp';
import sofaModel from '@/assets/furniture/sofa.glb?url';
import sofaThumb from '@/assets/furniture/sofa.webp';
import chairCutout from '@/assets/furniture/chair-cutout.webp';
import sofaCutout from '@/assets/furniture/sofa-cutout.webp';
import type { PlacedFurniture } from '@/config/furniture';
import type { GeneratedModel } from '@/core/modelLibrary';

/**
 * 寸法（メートル）はモデルの外形と同じ比にしておく（縦横比を保って収めるため）。
 * 一覧は新しい順（配列の逆順）に並ぶので、サンプル 1 が先に見えるよう後ろに置く
 */
export const SAMPLE_MODELS: GeneratedModel[] = [
  { id: 'sample-sofa', name: 'サンプル 2', modelKey: sofaModel, imageKey: sofaCutout, previewKey: sofaThumb, size: [1.6, 0.85, 0.85], createdAt: 0 },
  { id: 'sample-chair', name: 'サンプル 1', modelKey: chairModel, imageKey: chairCutout, previewKey: chairThumb, size: [0.44, 0.9, 0.54], createdAt: 0 },
];

/** サンプルの中身の今の URL。ファイル名と種類（モデル・切り抜き・アイコン）ごと */
const SAMPLE_ASSETS: Record<string, { model: string; cutout: string; thumb: string }> = {
  chair: { model: chairModel, cutout: chairCutout, thumb: chairThumb },
  sofa: { model: sofaModel, cutout: sofaCutout, thumb: sofaThumb },
};

/**
 * 以前の版で配ったサンプルの中身の URL。ファイル名に中身のハッシュが付く（例: /assets/chair-B0Ww7snD.glb）。
 * 中身を差し替えるとハッシュが変わり、端末に残った古い URL では読めなくなる（公開先から古いファイルが消える）
 */
const LEGACY_SAMPLE_ASSET = /\/assets\/(chair|sofa)(-cutout)?-[A-Za-z0-9_-]{8}\.(glb|webp)$/;

/** 以前の版のサンプルの中身の URL なら、今の URL に読み替える。それ以外はそのまま返す */
export function currentSampleAsset(url: string): string {
  const match = LEGACY_SAMPLE_ASSET.exec(url);
  if (!match) return url;
  const assets = SAMPLE_ASSETS[match[1]];
  return match[3] === 'glb' ? assets.model : match[2] ? assets.cutout : assets.thumb;
}

/**
 * 置いてある家具のうち、サンプルを置いたものの中身の URL を今のものにする（起動時に読み戻すとき）。
 * アイコンは中身と一緒に今のサンプルのものにする（アイコンは小さいのでアプリに埋め込んであり、URL では見分けられない）
 */
export function withCurrentSampleAssets(item: PlacedFurniture): PlacedFurniture {
  const sample = sampleOf(item.modelUrl) ?? sampleOf(item.imageUrl);
  if (!sample) return item;
  return {
    ...item,
    modelUrl: item.modelUrl && currentSampleAsset(item.modelUrl),
    imageUrl: item.imageUrl && currentSampleAsset(item.imageUrl),
    sourceImageKey: sample.thumb,
  };
}

/** URL がサンプルの中身（以前の版のものも含む）なら、そのサンプルの今の中身 */
function sampleOf(url: string | undefined): (typeof SAMPLE_ASSETS)[string] | null {
  if (!url) return null;
  const current = currentSampleAsset(url);
  return Object.values(SAMPLE_ASSETS).find((assets) => assets.model === current || assets.cutout === current) ?? null;
}
