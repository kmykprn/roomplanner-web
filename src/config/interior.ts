/**
 * 内装のテンプレート（部屋モードの「内装」タブ）。
 *
 * 壁と床の柄の組み合わせ。柄はすべて計算で描く（scene/interiorTextures.ts）ので、
 * 写真素材は持たない。ここにあるのは「どの柄をどの色で」という組み合わせと、
 * タブに出す小さな絵（あらかじめ描いたものを取り込む）。
 *
 * 和室だけは畳数で部屋の大きさが決まる（畳は半端に切れないため）。
 */

import white from '@/assets/interior/white.webp';
import natural from '@/assets/interior/natural.webp';
import nordic from '@/assets/interior/nordic.webp';
import modern from '@/assets/interior/modern.webp';
import classic from '@/assets/interior/classic.webp';
import french from '@/assets/interior/french.webp';
import industrial from '@/assets/interior/industrial.webp';
import midcentury from '@/assets/interior/midcentury.webp';
import japanese from '@/assets/interior/japanese.webp';
import hotel from '@/assets/interior/hotel.webp';
import bath from '@/assets/interior/bath.webp';
import country from '@/assets/interior/country.webp';
import { ROOM_DEFAULT, type RoomSize } from '@/config/room';

export type InteriorTemplateId =
  | 'white' | 'natural' | 'nordic' | 'modern' | 'classic' | 'french'
  | 'industrial' | 'midcentury' | 'japanese' | 'hotel' | 'bath' | 'country';

export interface InteriorTemplate {
  id: InteriorTemplateId;
  name: string;
  /** タブのタイルに出す絵（Vite が取り込んだ URL） */
  thumbnail: string;
}

export const INTERIOR_TEMPLATES: InteriorTemplate[] = [
  { id: 'white', name: '白い壁', thumbnail: white },
  { id: 'natural', name: 'ナチュラル', thumbnail: natural },
  { id: 'nordic', name: '北欧', thumbnail: nordic },
  { id: 'modern', name: 'モダン', thumbnail: modern },
  { id: 'classic', name: 'クラシック', thumbnail: classic },
  { id: 'french', name: 'フレンチ', thumbnail: french },
  { id: 'industrial', name: 'インダストリアル', thumbnail: industrial },
  { id: 'midcentury', name: 'ミッドセンチュリー', thumbnail: midcentury },
  { id: 'japanese', name: '和室', thumbnail: japanese },
  { id: 'hotel', name: 'ホテル', thumbnail: hotel },
  { id: 'bath', name: '水回り', thumbnail: bath },
  { id: 'country', name: 'カントリー', thumbnail: country },
];

export const DEFAULT_INTERIOR: InteriorTemplateId = 'white';

/** 和室で選べる畳数 */
export type TatamiMats = 6 | 8 | 10;
export const TATAMI_CHOICES: TatamiMats[] = [6, 8, 10];
export const DEFAULT_MATS: TatamiMats = 8;

/** 半畳の一辺（江戸間、メートル）。1 畳は 1.76 × 0.88m */
export const TATAMI_HALF = 0.88;

/**
 * 畳数ごとの定番の割付（祝儀敷き）。座標は半畳の単位で [x, y, 幅, 高さ]。
 * どれも 4 枚の角が 1 点に集まる「十字」が出ないことを確かめてある
 */
export const TATAMI_LAYOUTS: Record<TatamiMats, { units: [number, number]; mats: [number, number, number, number][] }> = {
  6: { units: [4, 3], mats: [[0, 0, 2, 1], [2, 0, 2, 1], [0, 1, 1, 2], [1, 1, 2, 1], [1, 2, 2, 1], [3, 1, 1, 2]] },
  8: { units: [4, 4], mats: [[0, 0, 2, 1], [2, 0, 2, 1], [0, 1, 1, 2], [1, 1, 2, 1], [1, 2, 2, 1], [3, 1, 1, 2], [0, 3, 2, 1], [2, 3, 2, 1]] },
  10: { units: [5, 4], mats: [[0, 0, 2, 1], [2, 0, 2, 1], [4, 0, 1, 2], [0, 1, 1, 2], [1, 1, 2, 1], [1, 2, 2, 1], [3, 1, 1, 2], [4, 2, 1, 2], [0, 3, 2, 1], [2, 3, 2, 1]] },
};

/** テンプレートと畳数から部屋の大きさを決める。和室以外は既定の部屋 */
export function roomSizeFor(template: InteriorTemplateId, mats: TatamiMats): RoomSize {
  if (template !== 'japanese') return { ...ROOM_DEFAULT };
  const [ux, uy] = TATAMI_LAYOUTS[mats].units;
  // 和室は天井をやや低く。長押（床から 1.8m）が壁の中に収まる
  return { width: ux * TATAMI_HALF, depth: uy * TATAMI_HALF, height: 2.4 };
}
