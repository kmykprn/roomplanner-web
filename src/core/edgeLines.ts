/**
 * 写真の中の「まっすぐな縦の縁」を見つける。
 *
 * 床の傾きは、**現実で垂直なものが写真の上でどこへ集まるか**で決まる。
 * 壁の角・ドア枠・窓枠がそれにあたる。
 *
 * ここがするのは 2 つだけ。
 *
 *   1. 押せる候補を並べる（利用者が「どこを押せるか」を見て選べるように）
 *   2. 押された場所の縁を上下にたどって、直線を 1 本引く
 *
 * **どれが本物の垂直かは決めない。** カーテンのひだも縦の縁として出てくるが、
 * 見分けるのは人の仕事にしてある。自動で選ぼうとすると、ひだの本数に負けて
 * 壊れることを実測で確かめた（furniture3d の docs/08-floor-fit.md）。
 *
 * 学習モデルは使わない。明暗の変化を見るだけなので、追加のダウンロードは要らず、
 * 端末の中で数十ミリ秒で終わる。
 */

/** 写真の座標での線分。(x1, y1) が上、(x2, y2) が下 */
export interface EdgeLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** たどれた行数。長いほど向きが正確 */
  support: number;
}

/** 検出に使う縮小後の長辺（画素）。細かい模様を落とし、太い縁だけ残すふるいにもなる */
const WORK_EDGE = 480;

/** 縁とみなす明暗の差。低いと模様を拾い、高いと弱い縁を逃す */
const MIN_CONTRAST = 14;

/** 縁を追うとき、1 行ごとに横へ探す幅（画素） */
const SEARCH_HALF = 6;

/** 線として認めるのに必要な行数（縮小後）。短い線は向きが不正確なので捨てる */
const MIN_SUPPORT = 40;

/** 直線からこれだけ外れた行は、同じ縁ではないとみなす */
const MAX_RESIDUAL = 2.2;

/** 候補を探す種を置く間隔（縮小後の画素） */
const SEED_STEP = 12;

/** 縁が途切れても、これだけの行までは飛び越えて追い続ける（影・汚れ・物の手前） */
const MAX_MISSES = 3;

/**
 * 候補として出す線の、画面上での傾きの上限。
 *
 * 実写で試すと、これを緩めた分だけカーテンのひだが上位に入る（0.13〜0.29 で出てくる）。
 * 本物の壁の角や窓枠は、見下ろしていても画面上ではもっと立っている
 */
const MAX_CANDIDATE_SLOPE = 0.3;

/** 同じ線とみなす近さ。候補の重複を落とすのに使う */
const SAME_LINE_X = 10;
const SAME_LINE_SLOPE = 0.03;

interface Gray {
  data: Float32Array;
  width: number;
  height: number;
  /** 元の写真の座標に戻す倍率 */
  scale: number;
}

/** 画像を縮小して明るさだけの配列にする */
function toGray(source: ImageData): Gray {
  const scale = Math.min(1, WORK_EDGE / Math.max(source.width, source.height));
  const width = Math.max(2, Math.round(source.width * scale));
  const height = Math.max(2, Math.round(source.height * scale));
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(source.height - 1, Math.round(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(source.width - 1, Math.round(x / scale));
      const i = (sy * source.width + sx) * 4;
      // 明るさだけ見る。色は縁の判定に要らない
      data[y * width + x] =
        0.299 * source.data[i] + 0.587 * source.data[i + 1] + 0.114 * source.data[i + 2];
    }
  }
  return { data, width, height, scale };
}

/** その行で、中心のまわりを横に見て、明暗の変化がいちばん大きい場所を返す */
function strongestEdgeInRow(gray: Gray, row: number, center: number): { x: number; strength: number } | null {
  const from = Math.max(1, Math.round(center) - SEARCH_HALF);
  const to = Math.min(gray.width - 2, Math.round(center) + SEARCH_HALF);
  let bestX = -1;
  let best = 0;
  for (let x = from; x <= to; x += 1) {
    const diff = Math.abs(gray.data[row * gray.width + x + 1] - gray.data[row * gray.width + x - 1]);
    if (diff > best) {
      best = diff;
      bestX = x;
    }
  }
  return best >= MIN_CONTRAST ? { x: bestX, strength: best } : null;
}

/**
 * 種の位置から縁を上下にたどり、直線を当てる。
 *
 * 1 行ずつ「横に少し探して、いちばん強い変化の場所」を拾い、点を並べる。
 * **拾えなかった行が続いたらそこで終わり**にする（縁が途切れた、物に隠れた）。
 * 最後に直線を当て、大きく外れた点を落としてもう一度当てる。
 *
 * **たどれるところまで自動でたどる。** 手で伸ばす余地は残していない。実写の 13 か所で
 * 「弱い縁も拾う」設定に緩めて測ったところ、伸びたのは 1 か所だけで、その 1 か所も
 * 線の向きが変わっていた（別の物へ乗り移った）。縮んだ例も、何も見つからなくなる例もあった
 */
function traceFrom(gray: Gray, seedX: number, seedY: number): EdgeLine | null {
  const xs: number[] = [];
  const ys: number[] = [];

  for (const direction of [-1, 1]) {
    let center = seedX;
    let misses = 0;
    for (let y = seedY + direction; y > 0 && y < gray.height - 1; y += direction) {
      const found = strongestEdgeInRow(gray, y, center);
      if (!found) {
        misses += 1;
        // 少しの途切れ（影・汚れ）は越えるが、続いたら終わり
        if (misses > MAX_MISSES) break;
        continue;
      }
      misses = 0;
      center = found.x;
      xs.push(found.x);
      ys.push(y);
    }
  }
  if (xs.length < MIN_SUPPORT) return null;

  // x = a * y + b を最小二乗で当てる（縦の線なので y を独立変数にする）
  const fit = fitLine(xs, ys);
  if (!fit) return null;
  const keptX: number[] = [];
  const keptY: number[] = [];
  for (let i = 0; i < xs.length; i += 1) {
    if (Math.abs(xs[i] - (fit.a * ys[i] + fit.b)) < MAX_RESIDUAL) {
      keptX.push(xs[i]);
      keptY.push(ys[i]);
    }
  }
  if (keptX.length < MIN_SUPPORT) return null;
  const refined = fitLine(keptX, keptY);
  if (!refined) return null;

  const top = Math.min(...keptY);
  const bottom = Math.max(...keptY);
  return {
    x1: (refined.a * top + refined.b) / gray.scale,
    y1: top / gray.scale,
    x2: (refined.a * bottom + refined.b) / gray.scale,
    y2: bottom / gray.scale,
    support: keptY.length,
  };
}

function fitLine(xs: number[], ys: number[]): { a: number; b: number } | null {
  const n = xs.length;
  let sy = 0;
  let sx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sy += ys[i];
    sx += xs[i];
    syy += ys[i] * ys[i];
    sxy += xs[i] * ys[i];
  }
  const denominator = n * syy - sy * sy;
  if (Math.abs(denominator) < 1e-6) return null;
  return { a: (n * sxy - sy * sx) / denominator, b: (syy * sx - sy * sxy) / denominator };
}

/** 押された場所の縁をたどって線を返す。近くに縁が無ければ null */
export function traceEdgeAt(source: ImageData, x: number, y: number): EdgeLine | null {
  const gray = toGray(source);
  const row = Math.round(y * gray.scale);
  const column = Math.round(x * gray.scale);
  if (row < 1 || row >= gray.height - 1) return null;
  // 押した点のまわりで、いちばん強い縁を種にする（指は数画素ずれるため）
  const seed = strongestEdgeInRow(gray, row, column);
  if (!seed) return null;
  return traceFrom(gray, seed.x, row);
}

/**
 * 押せる候補を集める。
 *
 * 画像に等間隔で種を置き、それぞれから縁をたどる。同じ線に行き着いたものは 1 本にまとめる。
 * **縦に近いものだけ残す**（横の縁は別の役目なので、この関数では扱わない）
 */
export function detectVerticalLines(source: ImageData, limit = 6): EdgeLine[] {
  const gray = toGray(source);
  const found: EdgeLine[] = [];

  for (let y = SEED_STEP; y < gray.height - SEED_STEP; y += SEED_STEP) {
    for (let x = SEED_STEP; x < gray.width - SEED_STEP; x += SEED_STEP) {
      const seed = strongestEdgeInRow(gray, y, x);
      if (!seed || Math.abs(seed.x - x) > 2) continue; // 種のすぐそばに縁があるものだけ
      const line = traceFrom(gray, seed.x, y);
      if (!line) continue;
      // 画面の上で縦に近いものだけ（横の縁は拾わない）
      const slope = Math.abs(line.x2 - line.x1) / Math.max(1, Math.abs(line.y2 - line.y1));
      if (slope > MAX_CANDIDATE_SLOPE) continue;
      if (!found.some((other) => isSameLine(other, line))) found.push(line);
    }
  }
  return found.sort((a, b) => b.support - a.support).slice(0, limit);
}

/** 2 本が同じ縁か。傾きと、上端での横位置で見る */
function isSameLine(a: EdgeLine, b: EdgeLine): boolean {
  const slopeA = (a.x2 - a.x1) / Math.max(1, a.y2 - a.y1);
  const slopeB = (b.x2 - b.x1) / Math.max(1, b.y2 - b.y1);
  if (Math.abs(slopeA - slopeB) > SAME_LINE_SLOPE) return false;
  // 同じ高さでの横位置を比べる
  const y = (a.y1 + a.y2 + b.y1 + b.y2) / 4;
  const xa = a.x1 + slopeA * (y - a.y1);
  const xb = b.x1 + slopeB * (y - b.y1);
  return Math.abs(xa - xb) < SAME_LINE_X;
}
