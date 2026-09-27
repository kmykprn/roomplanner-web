/**
 * 室内の寸法の計算の、進み具合の 1 行（寸法の画面のボタンの下）。
 *
 *   ✻ 写真の奥行きを計算しています… 12秒
 *
 * 計算は長いと数十秒かかる。止まっていないことが分かるように、**経過秒数と、いまやっている
 * ことを 1 行だけ**出す。行は段階が進むごとに入れ替わる（Claude Code の進み具合と同じ見せ方）。
 * 先頭の記号は ✻ 1 つだけで、動いていることはゆっくり回して示す（CSS）。形を入れ替えると目がちらついた。
 */

import { photoState, type MeasureState } from '@/core/photoState';

/** 計算中の先頭の記号 */
const SPARK = '✻';
/** 経過秒数を書き換える間隔（ms）。秒の変わり目から遅れすぎないよう、1 秒より短くする */
const TICK_INTERVAL_MS = 250;

const BYTES_PER_MB = 1024 * 1024;

/** いまやっていることの文 */
function stepText(measure: Extract<MeasureState, { status: 'running' }>): string {
  switch (measure.step) {
    case 'download': {
      const download = measure.download;
      if (!download) return '計算に使うデータをダウンロードしています';
      const loaded = Math.round(download.loaded / BYTES_PER_MB);
      const amount = download.total ? `${loaded} / ${Math.round(download.total / BYTES_PER_MB)}MB` : `${loaded}MB`;
      return `計算に使うデータをダウンロードしています（${amount}）`;
    }
    case 'calibrate':
      return '写真の傾きと画角を計算しています';
    case 'depth':
      return '写真の奥行きを計算しています';
    case 'fit':
      return '線の長さから縮尺を合わせています';
  }
}

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
    line.hidden = measure.status === 'idle';
    line.classList.toggle('is-error', measure.status === 'failed');
    line.classList.toggle('is-running', measure.status === 'running');

    if (measure.status === 'running') {
      glyph.textContent = SPARK;
      text.textContent = `${stepText(measure)}…`;
      tick();
      if (timer === null) timer = window.setInterval(tick, TICK_INTERVAL_MS);
      return;
    }
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    glyph.textContent = measure.status === 'done' ? '✓' : measure.status === 'failed' ? '!' : '';
    seconds.textContent = measure.status === 'done' && measure.seconds !== null ? `${Math.round(measure.seconds)}秒` : '';
    text.textContent =
      measure.status === 'done'
        ? '室内の寸法を計算しました。'
        : measure.status === 'failed'
          ? measure.reason === 'lines'
            ? '線の端の奥行きが分からないため、室内の寸法を計算できませんでした。'
            : '室内の寸法を計算できませんでした。'
          : '';
  }

  render();
  photoState.subscribe(render);
  return line;
}
