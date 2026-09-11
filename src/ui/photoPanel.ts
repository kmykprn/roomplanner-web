/**
 * 写真モードの「背景」タブ。背景にする写真を選ぶだけ。
 *
 * 写真の取得は platform/picker.ts 越しに行う。
 * Capacitor で iOS アプリにするとき、差し替えるのはあちらの中身だけで済む。
 */

import { pickImage } from '@/platform/picker';
import { photoState, setBackground } from '@/core/photoState';

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
    if (file) setBackground(file);
  });

  const clearButton = document.createElement('button');
  clearButton.className = 'button is-quiet';
  clearButton.textContent = '外す';
  clearButton.addEventListener('click', () => setBackground(null));

  panel.append(pickButton, clearButton, status);

  function render(): void {
    const { backgroundName } = photoState.get();
    pickButton.textContent = backgroundName ? '写真を変える' : '写真を選ぶ';
    clearButton.hidden = !backgroundName;
    status.textContent = backgroundName ?? IDLE_MESSAGE;
  }

  render();
  photoState.subscribe(render);

  return panel;
}
