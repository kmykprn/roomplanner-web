/**
 * 室内の寸法の計算の、進み具合の 1 行（寸法の画面の線の枠の下）。計算中と失敗したときだけ出す。
 *
 *   ✻ 写真を解析しています… 12秒
 *
 * 写真の解析は背景を選んだときに裏で始まるので、ふつうは保存の時点で終わっている。まだのときだけ、
 * 止まっていないことが分かるように**経過秒数と 1 行**を出す（Claude Code の進み具合と同じ見せ方）。
 * 文は段階を分けず「写真を解析しています」だけ（ダウンロードなどの言葉は出すと驚かれる）。
 * 先頭の記号は ✻ 1 つだけで、動いていることはゆっくり回して示す（CSS）。形を入れ替えると目がちらついた。
 */

import { photoState } from '@/core/photoState';

/** 計算中の先頭の記号 */
const SPARK = '✻';
/** 経過秒数を書き換える間隔（ms）。秒の変わり目から遅れすぎないよう、1 秒より短くする */
const TICK_INTERVAL_MS = 250;

export function createMeasureStatus(): HTMLElement {
  const line = document.createElement('p');
  line.className = 'measure-status';
  line.setAttribute('role', 'status');
  const glyph = document.createElement('span');
  glyph.className = 'measure-status__glyph';
  glyph.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  const seconds = document.createElement('span');
  seconds.className = 'measure-status__seconds';
  line.append(glyph, text, seconds);

  let timer: number | null = null;

  /** 経過秒数だけを書き換える（文は状態が変わったときに render が書く） */
  function tick(): void {
    const { measure } = photoState.get();
    if (measure.status !== 'running') return;
    seconds.textContent = `${Math.floor((Date.now() - measure.startedAt) / 1000)}秒`;
  }

  function render(): void {
    const { measure } = photoState.get();
    // 出すのは計算中と失敗だけ。計算できたら画面を閉じるので、「計算しました」は出さない
    line.hidden = measure.status !== 'running' && measure.status !== 'failed';
    line.classList.toggle('is-error', measure.status === 'failed');
    line.classList.toggle('is-running', measure.status === 'running');

    if (measure.status === 'running') {
      glyph.textContent = SPARK;
      text.textContent = '写真を解析しています…';
      tick();
      if (timer === null) timer = window.setInterval(tick, TICK_INTERVAL_MS);
      return;
    }
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    if (measure.status !== 'failed') return;
    glyph.textContent = '!';
    seconds.textContent = '';
    text.textContent =
      measure.reason === 'lines'
        ? '線の端の奥行きが分からないため、室内の寸法を計算できませんでした。'
        : '室内の寸法を計算できませんでした。';
  }

  render();
  photoState.subscribe(render);
  return line;
}
