/**
 * 写真モードで写真がまだ無いとき、キャンバスの真ん中に出す案内。
 *
 * 起動時は写真モードなので、初回はこれが最初の画面になる。何も無い灰色の
 * キャンバスだけだと、何から始めればいいか分からない。写真を選ぶ入口は、ここだけ
 * （写真を選んだあとの変更は、写真の右上の［⋯］。ui/photoMenu.ts）。
 *
 * 写真が入ったら消える。読み込み中も消す（押させると、どちらが背景になるのか分からない）。
 * 読み込みに失敗したときは、その理由と一緒にもう一度出す。
 */

import { modeState, isPhotoMode } from '@/core/mode';
import { photoState, setBackground } from '@/core/photoState';
import { pickImage } from '@/platform/picker';
import { FAILED_MESSAGE, IDLE_MESSAGE } from '@/ui/photoPanel';


export function createPhotoEmpty(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'viewport__empty';

  const icon = document.createElement('span');
  icon.className = 'viewport__empty-icon';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button';
  button.textContent = '背景の画像を選ぶ';
  button.addEventListener('click', async () => {
    const file = await pickImage();
    if (file) await setBackground(file);
  });

  const note = document.createElement('p');
  note.className = 'hint';

  element.append(icon, button, note);

  function render(): void {
    const { backgroundStatus } = photoState.get();
    const failed = backgroundStatus === 'failed';
    // 写真が無いときだけ。読み込み中・端末に残した写真を読み戻している間・写真がある間は出さない
    element.hidden = !isPhotoMode() || ['ready', 'loading', 'restoring'].includes(backgroundStatus);
    note.classList.toggle('is-error', failed);
    note.textContent = failed ? FAILED_MESSAGE : IDLE_MESSAGE;
  }

  render();
  photoState.subscribe(render);
  modeState.subscribe(render);
  return element;
}
