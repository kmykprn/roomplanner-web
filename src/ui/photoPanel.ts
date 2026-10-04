/**
 * 写真モードの背景の調整の画面。写真の右上の［⋯］（ui/photoMenu.ts）で選んだときだけ、下のパネルに出す。
 *
 *   拡大・縮小         … ui/framePanel.ts
 *   寸法               … ui/scalePanel.ts
 *   家具を隠す範囲     … ui/maskPanel.ts
 *
 * どれも「‹ 戻る」か「保存」で閉じ、下のパネルは置いた家具の一覧に戻る（ui/bottomSheet.ts）。
 * 前はここが「背景」タブで、［背景の画像を変更］と［✎ 編集］も並べていた（写真の右上の［⋯］に移した）
 */

import { createMaskPanel } from '@/ui/maskPanel';
import { createScalePanel } from '@/ui/scalePanel';
import { createFramePanel } from '@/ui/framePanel';
import { photoState } from '@/core/photoState';

/** 背景の画像がまだ無いときの案内。キャンバスの案内（ui/photoEmpty.ts）が使う */
export const IDLE_MESSAGE = '選択した画像の上に家具を置くことができます';
/** 形式と大きさのどちらでも起こる。利用者にできることを先に出す。キャンバスの案内も使う */
export const FAILED_MESSAGE = '背景の画像を読み込めませんでした。別の画像をお試しください';

export function createPhotoPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'photo';
  /** 家具を隠す範囲を指定する画面 */
  const mask = createMaskPanel();
  /** 寸法を合わせる画面 */
  const scale = createScalePanel();
  /** 拡大・縮小する画面 */
  const frame = createFramePanel();
  // どの画面も、自分の状態（isFramingPhoto など）を見て自分で出し入れする
  panel.append(frame, scale, mask);
  return panel;
}

/** 背景の調整の画面に入っているか（拡大・縮小・寸法・家具を隠す範囲のどれか） */
export function isAdjustingPhoto(): boolean {
  const { isMasking, isScaling, isFramingPhoto } = photoState.get();
  return isMasking || isScaling || isFramingPhoto;
}
