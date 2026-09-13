/**
 * 写真モードで写真がまだ無いとき、キャンバスの真ん中に出す案内。
 *
 * 起動時は写真モードなので、初回はこれが最初の画面になる。何も無い灰色の
 * キャンバスだけだと、下のタブの「背景の画像 未選択」の行に気づくしかない。
 * 「部屋の写真を選ぶ」を押すと、タブの「選ぶ」と同じことをする。
 *
 * 写真が入ったら消える。読み込み中も消す（押させると、どちらが背景になるのか分からない）。
 * 読み込みに失敗したときは、その理由と一緒にもう一度出す。
 */

import { modeState, isPhotoMode } from '@/core/mode';
import { photoState, setBackground } from '@/core/photoState';
import { pickImage } from '@/platform/picker';
import { FAILED_MESSAGE } from '@/ui/photoPanel';

const IDLE_MESSAGE = '写真の上に3Dモデルを置けます';

export function createPhotoEmpty(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'viewport__empty';

  const icon = document.createElement('span');
  icon.className = 'viewport__empty-icon';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button';
  button.textContent = '部屋の写真を選ぶ';
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
    // 写真が無いときだけ。読み込み中と、写真がある間は出さない
    element.hidden = !isPhotoMode() || backgroundStatus === 'ready' || backgroundStatus === 'loading';
    note.classList.toggle('is-error', failed);
    note.textContent = failed ? FAILED_MESSAGE : IDLE_MESSAGE;
  }

  render();
  photoState.subscribe(render);
  modeState.subscribe(render);
  return element;
}
