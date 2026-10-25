/**
 * 写真モードで家具を動かしても、画面に写る大きさを変えないための計算。
 *
 * 写真モードの家具は奥行きのある 3D の中を動く（奥へ行けば遠近で小さく写る）。
 * ただし「奥へ動かしたら勝手に縮む」のは使いにくいので、動かす前後で画面に写る高さが同じになるよう、
 * 家具の 3D の大きさのほうを動かした分だけ変える。奥へ行けば 3D は大きくなり、画面では同じ大きさに見える。
 * 影や、写真の物の奥に入ったときに隠す判定は、その大きさでそのまま正しく動く。
 *
 * 「100%」の戻り先（baseSize）も同じ割合で変える。奥へ動かしてから「100%」を押しても縮まないように
 */

import type { PlacedFurniture } from '@/config/furniture';

/** 高さ height の物が足元 position に立つとき、画面の高さに占める割合（0〜1）。写らなければ null */
export type HeightShare = (position: [number, number, number], height: number) => number | null;

/**
 * 家具を position へ動かしたときに、動かす前と同じ大きさに写るための size と baseSize。
 * 前後のどちらかが写らない（割合が出ない）ときは、大きさを変えない。
 *
 * @param before 動かす前に画面に占めていた高さ。省くといまの位置で出す。写真を替えたあとの置き直しのように、
 *               カメラが変わる前に控えておいた値を使いたいときに渡す
 */
export function keepApparentSize(
  item: PlacedFurniture,
  position: [number, number, number],
  heightShare: HeightShare,
  before: number | null = heightShare(item.position, item.size[1])
): Pick<PlacedFurniture, 'size' | 'baseSize'> {
  if (!before || before <= 0) return { size: item.size, baseSize: item.baseSize };
  // 写る高さは 3D の高さにほぼ比例するが、カメラが傾いていると上端の奥行きが高さで変わり、厳密には比例しない。
  // 比率で近づけてから、写る高さが控えた値に一致するまで数回繰り返す（2〜3 回で 1e-5 以内に収まる）
  let height = item.size[1];
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const after = heightShare(position, height);
    if (!after || after <= 0) return { size: item.size, baseSize: item.baseSize };
    const step = before / after;
    height *= step;
    if (Math.abs(step - 1) < TOLERANCE) break;
  }
  const factor = height / item.size[1];
  return { size: scaled(item.size, factor), baseSize: item.baseSize ? scaled(item.baseSize, factor) : undefined };
}

/** 写る高さを合わせる繰り返しの上限と、打ち切る精度（比率の 1 からのずれ） */
const MAX_ROUNDS = 6;
const TOLERANCE = 1e-5;

function scaled(size: [number, number, number], factor: number): [number, number, number] {
  return [size[0] * factor, size[1] * factor, size[2] * factor];
}
