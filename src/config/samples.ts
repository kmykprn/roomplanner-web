/**
 * 最初から保管庫に入っている家具（サンプル）。
 *
 * 初回起動時に一度だけ保管庫に入れる（core/modelLibrary.ts）。作った家具と同じ扱いなので、
 * 名前を変えたり消したりできる。消したら次回も復活しない。
 *
 * モデルは自前で作ったもの: 画像生成（SDXL）で「白背景の商品写真」風の画像を作り、
 * 自前の 3D 生成（Hunyuan3D-2GP、背景除去は BiRefNet）に通した。第三者の写真・意匠は
 * 使っていない（作り方は README「サンプルの家具について」）。アイコンはモデルを描いたもの。
 *
 * GLB と画像は Vite に取り込ませ、ファイル名に内容のハッシュを付ける。端末は一度使った
 * モデルを保存して次からはそれを使う（vite.config.ts の runtimeCaching）ので、
 * 同じ名前のまま中身を差し替えると古い方が出続ける
 */

import chairModel from '@/assets/furniture/chair.glb?url';
import chairThumb from '@/assets/furniture/chair.webp';
import sofaModel from '@/assets/furniture/sofa.glb?url';
import sofaThumb from '@/assets/furniture/sofa.webp';
import type { GeneratedModel } from '@/core/modelLibrary';

/**
 * 寸法（メートル）はモデルの外形と同じ比にしておく（縦横比を保って収めるため）。
 * 一覧は新しい順（配列の逆順）に並ぶので、サンプル 1 が先に見えるよう後ろに置く
 */
export const SAMPLE_MODELS: GeneratedModel[] = [
  { id: 'sample-sofa', name: 'サンプル 2', modelKey: sofaModel, imageKey: null, previewKey: sofaThumb, size: [1.6, 0.85, 0.85], createdAt: 0 },
  { id: 'sample-chair', name: 'サンプル 1', modelKey: chairModel, imageKey: null, previewKey: chairThumb, size: [0.46, 0.9, 0.5], createdAt: 0 },
];
