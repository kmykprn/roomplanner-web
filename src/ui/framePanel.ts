/**
 * 「表示する範囲」の姿。写真を選んだ直後と、「背景」タブの行から入る。
 *
 * 写真は画面いっぱいに敷き、はみ出た分は切り落として見せている（core/photoView.ts）。
 * どこを見せるかを利用者に決めてもらう。1 本指でずらし、2 本指かバーで拡大・縮小する。
 * 縮めると写真全体が入り、その分は余白になる。
 *
 * **切るのは表示だけ。** 写真そのものは切らないので、画角や床合わせの計算は変わらない。
 */

import { photoState, setFramingPhoto, setPhotoView } from '@/core/photoState';
import { DEFAULT_PHOTO_VIEW, maxScale, minScale } from '@/core/photoView';
import { createSliderRow } from '@/ui/sliderRow';

const GUIDE = '写真を指でずらし、2 本指かバーで拡大・縮小して、表示する範囲を決めてください。';

/** バーの目盛りの数。倍率は掛け算で対応させる（同じ指の動きで同じ割合だけ変わる） */
const STEPS = 1000;

export function createFramePanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'floor-fit';

  const head = document.createElement('div');
  head.className = 'edit__head';
  const title = document.createElement('span');
  title.className = 'edit__title';
  title.textContent = '表示する範囲';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'button is-small';
  done.textContent = '完了';
  done.addEventListener('click', () => setFramingPhoto(false));
  head.append(title, done);

  const guide = document.createElement('p');
  guide.className = 'floor-fit__guide';
  guide.textContent = GUIDE;

  const zoom = createSliderRow({
    label: '大きさ',
    min: 0,
    max: STEPS,
    ends: ['全体', '拡大'],
    onInput: (value) => setPhotoView({ ...photoState.get().view, scale: sliderToScale(value) }),
  });

  // 画面いっぱい（倍率 1、下寄せ）に戻す。最初の見え方と同じ
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'button is-quiet is-small';
  reset.textContent = '画面いっぱいに戻す';
  reset.addEventListener('click', () => setPhotoView({ ...DEFAULT_PHOTO_VIEW }));
  const footer = document.createElement('div');
  footer.className = 'edit__actions';
  footer.append(reset);

  panel.append(head, guide, zoom.element, footer);

  function render(): void {
    const { isFramingPhoto, view } = photoState.get();
    panel.hidden = !isFramingPhoto;
    if (isFramingPhoto) zoom.setValue(scaleToSlider(view.scale));
  }
  render();
  photoState.subscribe(render);

  return panel;
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
