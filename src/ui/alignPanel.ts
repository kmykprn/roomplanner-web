/**
 * 写真モードの「床」タブ。写真の中の長方形に四角を合わせてもらう。
 *
 * ここで決まるのはカメラの `{ 画角・高さ・俯角・向き }`。
 * 合っているかどうかは**方眼が写真の床に貼り付いて見えるか**で判断してもらう。
 */

import { photoState, setAssumedFov, setFloorWidthMeters } from '@/core/photoState';

const GUIDE = '四角の4隅を、写真の中の長方形（ラグ・タイル・床の見切り）に合わせてください';

/** 画角が計算で出せなかったときの断り。手で直せることを伝える */
const FOV_ASSUMED_NOTE =
  '正面から撮った写真では画角が計算で出せません。奥行きが合わないときはここで調整してください';

/** 計算で出せたときの断り。触れない理由を伝える */
const FOV_MEASURED_NOTE = '画角は写真から計算できました。調整は要りません';
const FAILED = 'この形では合わせられません。角を戻してください';
const NO_PHOTO = '先に「背景」タブで写真を選んでください';

/** 画角を手で直せる範囲（度）。実在のカメラが収まる幅 */
const FOV_RANGE = { min: 20, max: 110 };

export function createAlignPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'align';

  const status = document.createElement('p');
  status.className = 'hint';

  // 四角の実寸。これを入れると、目分量だった寸法が実測になる
  const widthField = createField('四角の横幅', 'm');
  widthField.input.type = 'number';
  widthField.input.min = '0.1';
  widthField.input.step = '0.1';
  widthField.input.addEventListener('input', () => {
    setFloorWidthMeters(Number(widthField.input.value));
  });

  // 画角。計算で出せているときは触らせない（出した値のほうが確かなため）
  const fovField = createField('画角', '°');
  fovField.input.type = 'range';
  fovField.input.min = String(FOV_RANGE.min);
  fovField.input.max = String(FOV_RANGE.max);
  fovField.input.step = '1';
  fovField.input.addEventListener('input', () => {
    setAssumedFov(Number(fovField.input.value));
  });

  const fovNote = document.createElement('p');
  fovNote.className = 'hint align__note';

  panel.append(status, widthField.element, fovField.element, fovNote);

  function render(): void {
    const state = photoState.get();
    const hasPhoto = state.backgroundStatus === 'ready';
    const assumed = state.calibration?.fovAssumed ?? true;

    status.classList.toggle('is-error', hasPhoto && state.calibrationFailed);
    status.textContent = !hasPhoto ? NO_PHOTO : state.calibrationFailed ? FAILED : GUIDE;

    // **行を出し入れしない。** 出し入れするとパネルの高さが変わり、
    // その上にある 3D の表示領域まで動く。角をドラッグしている最中にこれが起きると、
    // 写真が指の下でずれて、狙った場所に角を置けなくなる（実際に踏んだ）
    widthField.input.disabled = !hasPhoto;
    // 画角が計算で出せているときは、仮定より計算の結果のほうが確かなので触らせない
    fovField.input.disabled = !hasPhoto || !assumed;
    fovNote.textContent = assumed ? FOV_ASSUMED_NOTE : FOV_MEASURED_NOTE;

    // 入力中の値を上書きしないよう、変わったときだけ書き戻す
    setIfChanged(widthField.input, String(state.floorWidthMeters));
    setIfChanged(fovField.input, String(Math.round(state.assumedFov)));
    widthField.value.textContent = `${state.floorWidthMeters} m`;
    fovField.value.textContent = `${Math.round(state.calibration?.fov ?? state.assumedFov)}°`;
  }

  render();
  photoState.subscribe(render);

  return panel;
}

interface Field {
  element: HTMLElement;
  input: HTMLInputElement;
  value: HTMLElement;
}

function createField(label: string, unit: string): Field {
  const element = document.createElement('label');
  element.className = 'align__field';

  const caption = document.createElement('span');
  caption.className = 'align__label';
  caption.textContent = label;

  const input = document.createElement('input');
  input.className = 'align__input';

  const value = document.createElement('span');
  value.className = 'align__value';
  value.textContent = unit;

  element.append(caption, input, value);
  return { element, input, value };
}

/** 入力欄に触っている最中の値を奪わないよう、違うときだけ書き込む */
function setIfChanged(input: HTMLInputElement, value: string): void {
  if (input.value !== value) input.value = value;
}
