/**
 * 「床を合わせる」姿。写真モードの「背景」タブから入る。
 *
 * 合わせるのは前後と左右の傾きだけで、床の上での向き（ヨー）は出てこない。
 * 決め方が 2 つある。
 *
 *   縁を押す（既定）… 写真の中の「現実で垂直な縁」を 2 つ押す。壁の角・ドア枠・窓枠。
 *                      押せば決まるので、目測で合わせる必要がない
 *   指で調整        … 板を見ながら指で傾ける。縁が写っていない写真のための逃げ道
 *
 * どちらでも、画面には薄い板が 1 枚出る（scene/floorMarkers.ts）。板は
 * **合っているかを見るためのもの**で、床に寝て見えれば合っている。床をタップすれば
 * 別の場所へ移せるので、手前と奥の何か所かで確かめられる（傾きが違うと、
 * 手前で合っていても奥で破綻する）。
 *
 * **度数は出さない。** 何度が正しいかは誰にも分からないので、数字は判断に使えない。
 */

import {
  clearVerticalEdges,
  photoState,
  setFittingFloor,
  setFloorFit,
  setFloorFitTool,
  type FloorFitTool,
} from '@/core/photoState';
import { DEFAULT_FLOOR_FIT } from '@/core/floorFit';

const TOOLS: { value: FloorFitTool; label: string }[] = [
  { value: 'edges', label: '縁を押す' },
  { value: 'manual', label: '指で調整' },
];

/** 縁を何本選んだかによって変わる案内。次に何をすればよいかだけを書く */
const EDGE_STEPS = [
  '壁の角・ドア枠・窓枠など、床から天井へまっすぐ伸びている縁を押してください',
  'もう 1 つ、離れた場所の縁を押してください',
  '板が床に寝て見えれば合っています。別の縁を押すと選び直せます',
];

const MANUAL_HOW = '板の外をなぞる … 傾きを変える　／　床をタップ … その場所に板を移す';

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

  // 決め方の切り替え。既定の「縁を押す」で足りるが、縁の無い写真もあるので逃げ道を残す
  const tools = document.createElement('div');
  tools.className = 'seg';
  const toolButtons = TOOLS.map(({ value, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'seg__item';
    button.textContent = label;
    button.addEventListener('click', () => setFloorFitTool(value));
    tools.append(button);
    return { value, button };
  });

  const note = document.createElement('p');
  note.className = 'hint';

  const notice = document.createElement('p');
  notice.className = 'hint is-error';

  // 選んだ縁を外す。押し間違えたときに戻れる場所
  const clearEdges = document.createElement('button');
  clearEdges.type = 'button';
  clearEdges.className = 'button is-quiet is-small';
  clearEdges.textContent = '選んだ縁を外す';
  clearEdges.addEventListener('click', clearVerticalEdges);

  // やり直し。触りすぎて分からなくなったときに戻れる場所を必ず残す
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'button is-quiet is-small';
  reset.textContent = '最初の傾きに戻す';
  reset.addEventListener('click', () => {
    clearVerticalEdges();
    setFloorFit({ ...DEFAULT_FLOOR_FIT });
  });

  const footer = document.createElement('div');
  footer.className = 'edit__actions';
  footer.append(clearEdges, reset);

  panel.append(head, tools, note, notice, footer);

  function render(): void {
    const { isFittingFloor, floorFitTool, verticalEdges, edgeNotice } = photoState.get();
    panel.hidden = !isFittingFloor;
    if (!isFittingFloor) return;

    for (const { value, button } of toolButtons) {
      button.classList.toggle('is-active', value === floorFitTool);
    }

    const pickingEdges = floorFitTool === 'edges';
    note.textContent = pickingEdges
      ? EDGE_STEPS[Math.min(verticalEdges.length, EDGE_STEPS.length - 1)]
      : MANUAL_HOW;

    notice.textContent = edgeNotice ?? '';
    notice.hidden = !edgeNotice;
    clearEdges.hidden = !pickingEdges || verticalEdges.length === 0;
  }
  render();
  photoState.subscribe(render);

  return panel;
}
