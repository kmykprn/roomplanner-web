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
import { DEFAULT_FLOOR_FIT, FLOOR_FIT_LIMITS, type FloorFit } from '@/core/floorFit';
import { createSliderRow } from '@/ui/sliderRow';

const NOTE = '板が床にぴったり寝て見えるまで、下のバーで調整してください';
const HOW = '床をタップ … その場所に板を移す';

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

  // 傾きはここで変える。**写真の上には置かない。**
  // 写真の上に重ねると、指が板に取られて動かせない（板を掴む操作と同じ場所になるため）
  const pitch = createTiltRow('前後の傾き', ['手前', '奥'], FLOOR_FIT_LIMITS.pitch, (value) =>
    updateFit({ pitchDeg: value })
  );
  const roll = createTiltRow('左右の傾き', ['左', '右'], FLOOR_FIT_LIMITS.roll, (value) =>
    updateFit({ rollDeg: value })
  );

  // やり直し。触りすぎて分からなくなったときに戻れる場所を必ず残す
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'button is-quiet is-small';
  reset.textContent = '最初の傾きに戻す';
  reset.addEventListener('click', () => setFloorFit({ ...DEFAULT_FLOOR_FIT }));

  const footer = document.createElement('div');
  footer.className = 'edit__actions';
  footer.append(reset);

  panel.append(head, note, how, pitch.element, roll.element, footer);

  function render(): void {
    const { isFittingFloor, floorFit } = photoState.get();
    panel.hidden = !isFittingFloor;
    if (!isFittingFloor) return;
    pitch.setValue(Math.round(floorFit.pitchDeg));
    roll.setValue(Math.round(floorFit.rollDeg));
  }
  render();
  photoState.subscribe(render);

  return panel;
}

/**
 * 傾きの行を 1 つ作る。
 *
 * **両端は向きの言葉にする。** 何度が正しいかは誰にも分からないので、
 * 度数を出しても判断に使えない。「手前へ倒すのか奥へ倒すのか」だけ分かればよい
 */
function createTiltRow(
  label: string,
  ends: [string, string],
  limits: { min: number; max: number },
  onInput: (value: number) => void
): ReturnType<typeof createSliderRow> {
  return createSliderRow({ label, min: limits.min, max: limits.max, ends, onInput });
}

/** 片方の傾きだけ差し替える */
function updateFit(patch: Partial<FloorFit>): void {
  setFloorFit({ ...photoState.get().floorFit, ...patch });
}
