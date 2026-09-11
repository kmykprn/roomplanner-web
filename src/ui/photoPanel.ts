/**
 * 写真モードの「背景」タブ。背景にする写真を選ぶだけ。
 *
 * 写真の取得は platform/picker.ts 越しに行う。
 * Capacitor で iOS アプリにするとき、差し替えるのはあちらの中身だけで済む。
 */

import { pickImage } from '@/platform/picker';
import {
  clearBackground,
  photoState,
  setBackground,
  type BackgroundStatus,
} from '@/core/photoState';

/** 写真がまだ無いときの案内 */
const IDLE_MESSAGE = '部屋の写真を選ぶと、その上に家具を置けます';

export function createPhotoPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'row';

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

  panel.append(pickButton, clearButton, status);

  function render(): void {
    const { backgroundName, backgroundStatus } = photoState.get();
    const loading = backgroundStatus === 'loading';
    const failed = backgroundStatus === 'failed';

    pickButton.textContent = backgroundName && !failed ? '写真を変える' : '写真を選ぶ';
    // 読み込み中に押させると、どちらが背景になるのか分からなくなる
    pickButton.disabled = loading;
    clearButton.hidden = backgroundStatus !== 'ready';

    status.classList.toggle('is-error', failed);
    status.textContent = describe(backgroundStatus, backgroundName);
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
