/**
 * 「拡大・縮小」の画面。写真の右上の［⋯］（ui/photoMenu.ts）から入る。
 *
 * 背景の画像は画面いっぱいに敷き、はみ出た分は切り落として見せている（core/photoView.ts）。
 * どこを見せるかを利用者に決めてもらう。1 本指でずらし、2 本指かバーで拡大・縮小する。
 * 縮めると背景の画像の全体が入り、その分は余白になる。
 *
 * **切るのは表示だけ。** 画像そのものは切らないので、画角や寸法の計算は変わらない。
 * 「戻る」は入ったときの見え方に戻す。
 */

import { photoState, setFramingPhoto, setPhotoView } from '@/core/photoState';
import { DEFAULT_PHOTO_VIEW, maxScale, minScale, type PhotoView } from '@/core/photoView';
import { createSliderRow } from '@/ui/sliderRow';
import { createQuietButton, createSentences, createSubScreen } from '@/ui/subScreen';

const SENTENCES = ['背景を拡大・縮小するには、下のバーを操作するか、画面上を 2 本指で操作してください。'];

/** バーの目盛りの数。倍率は掛け算で対応させる（同じ指の動きで同じ割合だけ変わる） */
const STEPS = 1000;

export function createFramePanel(): HTMLElement {
  /** 入ったときの見え方。「戻る」でここに戻す */
  let entered: PhotoView | null = null;

  const screen = createSubScreen({
    title: '拡大・縮小',
    onBack: () => {
      if (entered) setPhotoView(entered);
      setFramingPhoto(false);
    },
    onDone: () => setFramingPhoto(false),
  });

  const zoom = createSliderRow({
    label: '倍率',
    hideLabel: true,
    min: 0,
    max: STEPS,
    ends: ['縮小', '拡大'],
    // 倍率 1 に戻すボタン。倍率 1 のバーの位置は、画面と写真の縦横比で変わる（最小の倍率が変わる）ので、そのつど求める
    reset: { value: () => scaleToSlider(1), label: '1倍' },
    onInput: (value) => setPhotoView({ ...photoState.get().view, scale: sliderToScale(value) }),
  });
  screen.body.append(createSentences(SENTENCES), zoom.element);
  // 最初の見え方（倍率 1、下寄せ）に戻す
  screen.actions.append(createQuietButton('初期値に戻す', () => setPhotoView({ ...DEFAULT_PHOTO_VIEW })));

  function render(): void {
    const { isFramingPhoto, view } = photoState.get();
    // 入った瞬間の見え方を控える
    if (isFramingPhoto && screen.element.hidden !== false) entered = { ...view };
    if (!isFramingPhoto) entered = null;
    screen.element.hidden = !isFramingPhoto;
    if (isFramingPhoto) zoom.setValue(scaleToSlider(view.scale));
  }
  screen.element.hidden = true;
  render();
  photoState.subscribe(render);

  return screen.element;
}

function sliderToScale(value: number): number {
  const low = minScale();
  return low * (maxScale() / low) ** (value / STEPS);
}

function scaleToSlider(scale: number): number {
  const low = minScale();
  const position = Math.log(scale / low) / Math.log(maxScale() / low);
  return Math.round(Math.min(1, Math.max(0, position)) * STEPS);
}
