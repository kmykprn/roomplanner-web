/**
 * 「床を合わせる」姿。写真モードの「背景」タブから入る。
 *
 * 画面には薄い板が 1 枚置かれる（scene/floorMarkers.ts）。利用者はそれを見て、
 * **床に寝ていないなら指で直す**。板の辺を床の目地や壁際の線と見比べられるので、
 * 目測ではなく比較で判断できる。合わせるのは前後と左右の傾きだけで、
 * 床の上での向き（ヨー）は出てこない。
 *
 * 板は床をタップした場所へ移せる。**タップした点には必ず板の中心が来る**ので、
 * そこでは板が浮かない。散らかっていない床へ逃がしたり、何か所かで確かめたりできる
 * （傾きが違うと、手前で合っていても奥で破綻する）。
 *
 * 数字は出さない。「何度にすればよいか」は誰にも分からないので、
 * 見た目がしっくりくるかどうかで決めてもらう。
 */

import { photoState, setFittingFloor, setFloorFit } from '@/core/photoState';
import { DEFAULT_FLOOR_FIT } from '@/core/floorFit';

const NOTE = '板が床にぴったり寝て見えるまで、画面を指でなぞって調整してください';
const HOW = '床をタップ … その場所に板を移す　／　板の外をなぞる … 傾きを変える';

export function createFloorPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'floor-fit';

  const head = document.createElement('div');
  head.className = 'edit__head';
  const title = document.createElement('span');
  title.className = 'edit__title';
  title.textContent = '床に合わせる';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'button is-small';
  done.textContent = '完了';
  done.addEventListener('click', () => setFittingFloor(false));
  head.append(title, done);

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = NOTE;

  const how = document.createElement('p');
  how.className = 'hint';
  how.textContent = HOW;

  // やり直し。触りすぎて分からなくなったときに戻れる場所を必ず残す
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'button is-quiet is-small';
  reset.textContent = '最初の傾きに戻す';
  reset.addEventListener('click', () => setFloorFit({ ...DEFAULT_FLOOR_FIT }));

  const footer = document.createElement('div');
  footer.className = 'edit__actions';
  footer.append(reset);

  panel.append(head, note, how, footer);

  function render(): void {
    panel.hidden = !photoState.get().isFittingFloor;
  }
  render();
  photoState.subscribe(render);

  return panel;
}
