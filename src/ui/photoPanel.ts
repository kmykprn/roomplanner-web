/**
 * 写真モードの「背景」タブ。背景にする写真を選ぶ。
 *
 * 写真の中で 3D モデルより手前に表示したい範囲も、写真に付いているものなので
 * ここから指定する。「手前の範囲を指定」を押すと、この場で指定する姿（ui/maskPanel.ts）に
 * 切り替わり、「完了」で戻る。
 *
 * 写真の取得は platform/picker.ts 越しに行う。
 * Capacitor で iOS アプリにするとき、差し替えるのはあちらの中身だけで済む。
 */

import { pickImage } from '@/platform/picker';
import { createMaskPanel } from '@/ui/maskPanel';
import {
  clearBackground,
  photoState,
  setBackground,
  setMasking,
  type BackgroundStatus,
} from '@/core/photoState';

/** 写真がまだ無いときの案内 */
const IDLE_MESSAGE = '部屋の写真を選ぶと、その上に家具を置けます';

export function createPhotoPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'photo';

  /** 通常の姿。写真を選ぶ・外す・手前の範囲へ */
  const normal = document.createElement('div');
  normal.className = 'photo__normal';
  /** 手前の範囲を指定する姿 */
  const mask = createMaskPanel();

  const status = document.createElement('p');
  status.className = 'hint';

  const pickButton = document.createElement('button');
  pickButton.className = 'button';
  pickButton.addEventListener('click', async () => {
    const file = await pickImage();
    if (file) await setBackground(file);
  });

  const clearButton = document.createElement('button');
  clearButton.className = 'button is-quiet';
  clearButton.textContent = '外す';
  clearButton.addEventListener('click', clearBackground);

  const photoRow = document.createElement('div');
  photoRow.className = 'row';
  photoRow.append(pickButton, clearButton, status);

  // 手前の範囲。写真があるときだけ出す
  const maskRow = document.createElement('div');
  maskRow.className = 'row';
  const maskButton = document.createElement('button');
  maskButton.className = 'button is-quiet';
  maskButton.textContent = '手前の範囲を指定';
  maskButton.addEventListener('click', () => setMasking(true));
  const maskNote = document.createElement('span');
  maskNote.className = 'hint photo__note';
  maskNote.textContent = '指定した範囲は3Dモデルの手前に表示されます';
  maskRow.append(maskButton, maskNote);

  normal.append(photoRow, maskRow);
  panel.append(normal, mask);

  function render(): void {
    const { backgroundName, backgroundStatus, isMasking } = photoState.get();
    const loading = backgroundStatus === 'loading';
    const failed = backgroundStatus === 'failed';

    pickButton.textContent = backgroundName && !failed ? '写真を変える' : '写真を選ぶ';
    // 読み込み中に押させると、どちらが背景になるのか分からなくなる
    pickButton.disabled = loading;
    clearButton.hidden = backgroundStatus !== 'ready';

    status.classList.toggle('is-error', failed);
    status.textContent = describe(backgroundStatus, backgroundName);

    maskRow.hidden = backgroundStatus !== 'ready';

    // 指定している間は通常の姿を引っ込め、指定する姿だけを出す
    normal.hidden = isMasking;
    mask.hidden = !isMasking;
  }

  render();
  photoState.subscribe(render);

  return panel;
}

function describe(status: BackgroundStatus, name: string | null): string {
  switch (status) {
    case 'loading':
      return '写真を読み込んでいます…';
    case 'ready':
      return name ?? '';
    case 'failed':
      // 形式と大きさのどちらでも起こる。利用者にできることを先に出す
      return '写真を読み込めませんでした。別の写真で試してください';
    case 'idle':
      return IDLE_MESSAGE;
  }
}
