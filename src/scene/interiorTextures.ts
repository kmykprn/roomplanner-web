/**
 * 内装の柄を計算で描く。写真素材は使わない。
 *
 * それぞれの柄は小さなキャンバスに描き、床や壁にタイルのように繰り返して貼る。
 * 実寸に合わせるため、床は 1m = FLOOR_PX px、壁は高さいっぱいを 1 枚にして横だけ繰り返す。
 * 乱数は種を固定してあるので、同じテンプレートは毎回同じ見た目になる。
 *
 * 畳だけは繰り返しではなく、部屋一面を 1 枚に描く（畳数ごとの割付があるため）。
 */

import * as THREE from 'three';
import {
  TATAMI_HALF,
  TATAMI_LAYOUTS,
  type InteriorTemplateId,
  type TatamiMats,
} from '@/config/interior';
import type { RoomSize } from '@/config/room';

const FLOOR_PX = 160;
const TATAMI_PX = 240;

/** 床と壁の柄。壁は横の繰り返し幅（メートル）を持つ */
export interface InteriorTextures {
  floor: THREE.Texture;
  /** 壁 1 枚ぶんの絵。高さは部屋の天井高、幅は tileWidth メートルぶん */
  wall: HTMLCanvasElement;
  wallTileWidth: number;
}

type Ctx = CanvasRenderingContext2D;
type Pattern = (room: RoomSize, rand: () => number) => [HTMLCanvasElement, [number, number]];
type WallPattern = (room: RoomSize, rand: () => number) => [HTMLCanvasElement, number];

// --- 道具 ---

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext('2d')!];
}

/** 横向きの細い筋（木目） */
function grain(g: Ctx, x: number, y: number, w: number, h: number, color: string, n: number, rand: () => number): void {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) g.fillRect(x, y + rand() * h, w, 1);
}

/** 下地に粒を散らす（漆喰・コンクリート・カーペット） */
function speckle(g: Ctx, w: number, h: number, base: string, n: number, alpha: number, rand: () => number): void {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(0,0,0,${rand() * alpha})`;
    g.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1 + rand() * 3);
  }
}

const pick = (colors: string[], rand: () => number): string => colors[Math.floor(rand() * colors.length)];

// --- 床 ---

/** 乱尺フローリング: 幅 12cm、長さ 60〜120cm で継ぎ目がずれる。1 タイル = 2m × 2m */
const planksRandom = (colors: string[], joint: string): Pattern => (room, rand) => {
  const size = 2 * FLOOR_PX;
  const [c, g] = canvas(size, size);
  const bw = 0.12 * FLOOR_PX;
  for (let row = 0; row * bw < size; row++) {
    let x = -rand() * 0.6 * FLOOR_PX;
    const y = row * bw;
    while (x < size) {
      const len = (0.6 + rand() * 0.6) * FLOOR_PX;
      g.fillStyle = pick(colors, rand);
      g.fillRect(x, y, len, bw);
      grain(g, x, y + 1, len, bw - 2, 'rgba(60,35,10,.10)', 6, rand);
      g.fillStyle = joint;
      g.fillRect(x, y, 1.5, bw);
      x += len;
    }
    g.fillStyle = joint;
    g.fillRect(0, y, size, 1.5);
  }
  return [c, [room.width / 2, room.depth / 2]];
};

/** ワイドプランク: 幅 20cm、長さ 1.2〜2m */
const widePlank = (colors: string[], joint: string): Pattern => (room, rand) => {
  const size = 2 * FLOOR_PX;
  const [c, g] = canvas(size, size);
  const bw = 0.2 * FLOOR_PX;
  for (let row = 0; row * bw < size; row++) {
    let x = -rand() * FLOOR_PX;
    const y = row * bw;
    while (x < size) {
      const len = (1.2 + rand() * 0.8) * FLOOR_PX;
      g.fillStyle = pick(colors, rand);
      g.fillRect(x, y, len, bw);
      grain(g, x, y + 2, len, bw - 4, 'rgba(60,50,40,.08)', 10, rand);
      g.fillStyle = joint;
      g.fillRect(x, y, 1.5, bw);
      x += len;
    }
    g.fillStyle = joint;
    g.fillRect(0, y, size, 1.5);
  }
  return [c, [room.width / 2, room.depth / 2]];
};

/**
 * ヘリンボーン: 板（幅 w、長さ 4w）を格子で割り付けて 45° 回す。
 * 格子の各マス (m, n) は r = (m - n) mod 8 で所属が決まる: r が 0..3 なら横板、4..7 なら縦板。
 * 回したあとの周期は縦横とも 8√2·w なので、その大きさに切り出せば継ぎ目なく繰り返せる
 */
const herringbone = (colors: string[], joint: string): Pattern => (room, rand) => {
  const w = Math.round(0.08 * FLOOR_PX);
  const L = 4 * w;
  const cells = 32;
  const [src, g] = canvas(cells * w, cells * w);
  const tone = (a: number, b: number): string => colors[((((a % 8) + 8) % 8) * 3 + (((b % 8) + 8) % 8) * 5) % colors.length];
  for (let m = -8; m < cells + 8; m++) {
    for (let n = -8; n < cells + 8; n++) {
      const r = (((m - n) % 8) + 8) % 8;
      if (r === 0) {
        g.fillStyle = tone(m, n);
        g.fillRect(m * w, n * w, L, w);
        grain(g, m * w, n * w + 1, L, w - 2, 'rgba(60,35,10,.12)', 3, rand);
        g.fillStyle = joint;
        g.fillRect(m * w, n * w, L, 1);
        g.fillRect(m * w, n * w, 1, w);
      } else if (r === 4) {
        g.fillStyle = tone(m, n);
        g.fillRect(m * w, (n - 3) * w, w, L);
        grain(g, m * w + 1, (n - 3) * w, w - 2, L, 'rgba(60,35,10,.12)', 3, rand);
        g.fillStyle = joint;
        g.fillRect(m * w, (n - 3) * w, 1, L);
        g.fillRect(m * w, (n - 3) * w, w, 1);
      }
    }
  }
  const period = Math.round(8 * Math.SQRT2 * w);
  const [c, o] = canvas(period, period);
  o.translate(period / 2, period / 2);
  o.rotate(Math.PI / 4);
  o.drawImage(src, -src.width / 2, -src.height / 2);
  return [c, [(room.width * FLOOR_PX) / period, (room.depth * FLOOR_PX) / period]];
};

/** シェブロン: 幅 8cm の板を 45° の平行四辺形に切って矢羽に組む。列幅は板の長さ 40cm の投影 */
const chevron = (colors: string[], joint: string): Pattern => (room, rand) => {
  const w = 0.08 * FLOOR_PX * Math.SQRT2;
  const cw = (0.4 * FLOOR_PX) / Math.SQRT2;
  const rows = 6;
  const [c, g] = canvas(cw * 2, w * rows);
  g.fillStyle = joint;
  g.fillRect(0, 0, c.width, c.height);
  for (let col = 0; col < 2; col++) {
    const x0 = col * cw;
    const s = col === 0 ? cw : -cw;
    const off = col === 0 ? 0 : cw;
    for (let k = -3; k < rows + 3; k++) {
      const y = off + k * w;
      g.fillStyle = pick(colors, rand);
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x0 + cw, y + s);
      g.lineTo(x0 + cw, y + s + w - 1.5);
      g.lineTo(x0, y + w - 1.5);
      g.closePath();
      g.fill();
      g.save();
      g.clip();
      grain(g, x0, Math.min(y, y + s), cw, w + Math.abs(s), 'rgba(60,35,10,.12)', 4, rand);
      g.restore();
    }
  }
  g.fillStyle = joint;
  g.fillRect(cw - 0.75, 0, 1.5, c.height);
  return [c, [(room.width * FLOOR_PX) / c.width, (room.depth * FLOOR_PX) / c.height]];
};

/** 市松パーケット: 30cm 角の中に板 5 枚。隣の升は向きを 90° 変える */
const parquet = (colors: string[], joint: string): Pattern => (room, rand) => {
  const sq = 0.3 * FLOOR_PX;
  const [c, g] = canvas(sq * 2, sq * 2);
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const x = i * sq;
      const y = j * sq;
      const vertical = (i + j) % 2 === 1;
      for (let k = 0; k < 5; k++) {
        g.fillStyle = pick(colors, rand);
        if (vertical) g.fillRect(x + (k * sq) / 5, y, sq / 5, sq);
        else g.fillRect(x, y + (k * sq) / 5, sq, sq / 5);
        g.fillStyle = joint;
        if (vertical) g.fillRect(x + (k * sq) / 5, y, 1, sq);
        else g.fillRect(x, y + (k * sq) / 5, sq, 1);
      }
      g.fillStyle = joint;
      g.fillRect(x, y, sq, 1.5);
      g.fillRect(x, y, 1.5, sq);
    }
  }
  return [c, [room.width / 0.6, room.depth / 0.6]];
};

/** カーペット: 細かい起毛のノイズ */
const carpet = (base: string): Pattern => (room, rand) => {
  const size = FLOOR_PX;
  const [c, g] = canvas(size, size);
  speckle(g, size, size, base, 9000, 0.25, rand);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(255,255,255,${rand() * 0.08})`;
    g.fillRect(rand() * size, rand() * size, 1, 1);
  }
  return [c, [room.width, room.depth]];
};

/** モルタル: 灰色の粒感に、大きく薄いコテむらと細い筋 */
const mortar = (): Pattern => (room, rand) => {
  const size = 2 * FLOOR_PX;
  const [c, g] = canvas(size, size);
  speckle(g, size, size, '#b3b1ac', 14000, 0.1, rand);
  for (let i = 0; i < 40; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.15 + rand() * 0.25);
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(${rand() > 0.5 ? '255,255,255' : '0,0,0'},${0.02 + rand() * 0.025})`);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, size, size);
  }
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = `rgba(0,0,0,${0.02 + rand() * 0.03})`;
    g.lineWidth = 1;
    g.beginPath();
    const x = rand() * size;
    const y = rand() * size;
    g.moveTo(x, y);
    g.lineTo(x + (rand() - 0.5) * 80, y + (rand() - 0.5) * 80);
    g.stroke();
  }
  return [c, [room.width / 2, room.depth / 2]];
};

/** テラゾー: 明るい下地に 1〜2cm の色の欠片 */
const terrazzo = (): Pattern => (room, rand) => {
  const size = 2 * FLOOR_PX;
  const [c, g] = canvas(size, size);
  speckle(g, size, size, '#e9e4dc', 3000, 0.05, rand);
  const chips = ['#3a3a3a', '#9a9a9a', '#c8724f', '#ffffff', '#5a7565', '#d9c39a'];
  for (let i = 0; i < 700; i++) {
    g.fillStyle = pick(chips, rand);
    g.beginPath();
    g.ellipse(rand() * size, rand() * size, 1 + rand() * 2.5, 0.8 + rand() * 1.8, rand() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  return [c, [room.width / 2, room.depth / 2]];
};

/**
 * 畳: 畳数ごとの定番の割付で部屋一面に敷く。
 * い草の目は 2px 周期の細い畝で、畝ごと・畳ごとに明るさを揺らす。縁（へり）は長辺だけ
 */
const tatami = (edge: string, mats: TatamiMats): Pattern => (room, rand) => {
  const P = TATAMI_PX;
  const [c, g] = canvas(room.width * P, room.depth * P);
  const U = TATAMI_HALF * P;
  const mat = (x: number, y: number, w: number, h: number, vertical: boolean): void => {
    const tone = 0.93 + rand() * 0.14;
    g.fillStyle = `rgb(${Math.round(188 * tone)},${Math.round(184 * tone)},${Math.round(112 * tone)})`;
    g.fillRect(x, y, w, h);
    const along = vertical ? h : w;
    const across = vertical ? w : h;
    for (let i = 0; i < across; i += 2) {
      const k = 0.55 + 0.45 * Math.abs(Math.sin(i * 0.9)) * (0.7 + rand() * 0.6);
      g.fillStyle = `rgba(255,255,215,${0.22 * k})`;
      if (vertical) g.fillRect(x + i, y, 1, along);
      else g.fillRect(x, y + i, along, 1);
      g.fillStyle = `rgba(60,70,15,${0.3 * (1.3 - k)})`;
      if (vertical) g.fillRect(x + i + 1, y, 1, along);
      else g.fillRect(x, y + i + 1, along, 1);
    }
    // 日焼けのムラ
    for (let b = 0; b < 4; b++) {
      const rg = g.createRadialGradient(x + rand() * w, y + rand() * h, 0, x + w / 2, y + h / 2, Math.max(w, h) * 0.5);
      rg.addColorStop(0, `rgba(120,110,40,${0.05 + rand() * 0.05})`);
      rg.addColorStop(1, 'rgba(120,110,40,0)');
      g.fillStyle = rg;
      g.fillRect(x, y, w, h);
    }
    // 経糸の筋
    g.fillStyle = 'rgba(90,100,40,.10)';
    for (let j = 0; j < along; j += 0.11 * P) {
      if (vertical) g.fillRect(x, y + j, w, 1);
      else g.fillRect(x + j, y, 1, h);
    }
    // 端は少し沈む
    for (const horizontal of [true, false]) {
      const sh = horizontal ? g.createLinearGradient(x, y, x + w, y) : g.createLinearGradient(x, y, x, y + h);
      sh.addColorStop(0, 'rgba(0,0,0,.10)');
      sh.addColorStop(0.06, 'rgba(0,0,0,0)');
      sh.addColorStop(0.94, 'rgba(0,0,0,0)');
      sh.addColorStop(1, 'rgba(0,0,0,.10)');
      g.fillStyle = sh;
      g.fillRect(x, y, w, h);
    }
    // 縁は長辺だけ。幅 3cm、織りの点
    const hw = 0.03 * P;
    g.fillStyle = edge;
    if (vertical) {
      g.fillRect(x, y, hw, h);
      g.fillRect(x + w - hw, y, hw, h);
    } else {
      g.fillRect(x, y, w, hw);
      g.fillRect(x, y + h - hw, w, hw);
    }
    g.fillStyle = 'rgba(255,255,255,.14)';
    if (vertical) {
      for (let j = 0; j < h; j += 6) {
        g.fillRect(x + hw / 2 - 1, y + j, 2, 2);
        g.fillRect(x + w - hw / 2 - 1, y + j, 2, 2);
      }
    } else {
      for (let j = 0; j < w; j += 6) {
        g.fillRect(x + j, y + hw / 2 - 1, 2, 2);
        g.fillRect(x + j, y + h - hw / 2 - 1, 2, 2);
      }
    }
  };
  for (const [x, y, w, h] of TATAMI_LAYOUTS[mats].mats) mat(x * U, y * U, w * U, h * U, h > w);
  return [c, [1, 1]];
};

// --- 壁（高さいっぱいを 1 枚にして、横に繰り返す） ---

const plaster = (base: string, amount = 0.12): WallPattern => (room, rand) => {
  const [c, g] = canvas(FLOOR_PX, room.height * FLOOR_PX);
  speckle(g, c.width, c.height, base, 2600, amount, rand);
  return [c, 1];
};

const paint = (base: string): WallPattern => (room, rand) => {
  const [c, g] = canvas(FLOOR_PX, room.height * FLOOR_PX);
  speckle(g, c.width, c.height, base, 400, 0.05, rand);
  return [c, 1];
};

/** 腰壁: 下 90cm を縦の板張り、上を漆喰。境に笠木 */
const wainscot = (upper: string, lower: string): WallPattern => (room, rand) => {
  const [c, g] = canvas(FLOOR_PX, room.height * FLOOR_PX);
  const hh = c.height;
  const split = hh - 0.9 * FLOOR_PX;
  speckle(g, c.width, hh, upper, 2000, 0.08, rand);
  g.fillStyle = lower;
  g.fillRect(0, split, c.width, hh - split);
  for (let x = 0; x < c.width; x += 0.1 * FLOOR_PX) {
    g.fillStyle = 'rgba(0,0,0,.10)';
    g.fillRect(x, split, 2, hh - split);
    g.fillStyle = 'rgba(255,255,255,.5)';
    g.fillRect(x + 3, split, 1, hh - split);
  }
  g.fillStyle = 'rgba(0,0,0,.18)';
  g.fillRect(0, split, c.width, 5);
  g.fillStyle = lower;
  g.fillRect(0, split - 8, c.width, 8);
  g.fillStyle = 'rgba(0,0,0,.12)';
  g.fillRect(0, split - 8, c.width, 2);
  return [c, 1];
};

/** 聚楽壁（土壁）+ 長押（床から 1.8m に横木） */
const juraku = (): WallPattern => (room, rand) => {
  const [c, g] = canvas(FLOOR_PX, room.height * FLOOR_PX);
  speckle(g, c.width, c.height, '#c9b48d', 4000, 0.16, rand);
  const y = c.height - 1.8 * FLOOR_PX;
  g.fillStyle = '#6b4a2b';
  g.fillRect(0, y - 0.09 * FLOOR_PX, c.width, 0.09 * FLOOR_PX);
  g.fillStyle = 'rgba(0,0,0,.25)';
  g.fillRect(0, y, c.width, 3);
  return [c, 1];
};

/** レンガ: 21×6cm、段ごとに半分ずらす */
const brick = (base: (tone: number) => string, mortarColor: string): WallPattern => (room, rand) => {
  const bw = 0.21 * FLOOR_PX;
  const bh = 0.06 * FLOOR_PX;
  const gap = 0.01 * FLOOR_PX;
  const [c, g] = canvas(bw * 2, room.height * FLOOR_PX);
  g.fillStyle = mortarColor;
  g.fillRect(0, 0, c.width, c.height);
  for (let row = 0; row * (bh + gap) < c.height; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 3; col++) {
      g.fillStyle = base(0.93 + rand() * 0.1);
      g.fillRect(col * bw + off + gap / 2, row * (bh + gap), bw - gap, bh);
    }
  }
  return [c, c.width / FLOOR_PX];
};

/** タイル: 10×20cm の白いタイル、灰の目地、横に半分ずらす */
const tiles = (base: string): WallPattern => (room) => {
  const tw = 0.2 * FLOOR_PX;
  const th = 0.1 * FLOOR_PX;
  const gap = 0.004 * FLOOR_PX;
  const [c, g] = canvas(tw * 2, room.height * FLOOR_PX);
  g.fillStyle = '#c9c9c4';
  g.fillRect(0, 0, c.width, c.height);
  for (let row = 0; row * th < c.height; row++) {
    const off = row % 2 ? tw / 2 : 0;
    for (let col = -1; col < 3; col++) {
      const x = col * tw + off;
      const y = row * th;
      g.fillStyle = base;
      g.fillRect(x + gap, y + gap, tw - gap * 2, th - gap * 2);
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.fillRect(x + gap, y + gap, tw - gap * 2, 2);
    }
  }
  return [c, c.width / FLOOR_PX];
};

/** 板張り: 幅 10cm の縦板。節を少し */
const boards = (colors: string[], joint: string): WallPattern => (room, rand) => {
  const bw = 0.1 * FLOOR_PX;
  const [c, g] = canvas(bw * 4, room.height * FLOOR_PX);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = pick(colors, rand);
    g.fillRect(i * bw, 0, bw, c.height);
    for (let k = 0; k < 12; k++) {
      g.fillStyle = 'rgba(90,60,20,.10)';
      g.fillRect(i * bw + rand() * bw, 0, 1, c.height);
    }
    if (rand() > 0.5) {
      g.fillStyle = 'rgba(90,60,20,.35)';
      g.beginPath();
      g.ellipse(i * bw + bw / 2, rand() * c.height, 5, 8, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = joint;
    g.fillRect(i * bw, 0, 1.5, c.height);
  }
  return [c, c.width / FLOOR_PX];
};

/** コンクリート: 粒感に、型枠の目地とセパ穴 */
const concreteWall = (): WallPattern => (room, rand) => {
  const [c, g] = canvas(1.8 * FLOOR_PX, room.height * FLOOR_PX);
  speckle(g, c.width, c.height, '#b9b8b3', 7000, 0.14, rand);
  g.fillStyle = 'rgba(0,0,0,.16)';
  g.fillRect(0.9 * FLOOR_PX, 0, 2, c.height);
  for (let y = 0.6 * FLOOR_PX; y < c.height; y += 0.9 * FLOOR_PX) {
    g.fillStyle = 'rgba(0,0,0,.16)';
    g.fillRect(0, y, c.width, 2);
    for (const x of [0.45 * FLOOR_PX, 1.35 * FLOOR_PX]) {
      g.beginPath();
      g.arc(x, y - 0.3 * FLOOR_PX, 5, 0, Math.PI * 2);
      g.fillStyle = 'rgba(0,0,0,.28)';
      g.fill();
    }
  }
  return [c, c.width / FLOOR_PX];
};

// --- テンプレートの組み合わせ ---

const OAK = ['#c9a883', '#bf9b74', '#d2b28f', '#b8946b', '#cda98a'];

const RECIPES: Record<InteriorTemplateId, { wall: WallPattern; floor: (mats: TatamiMats) => Pattern }> = {
  white: { wall: plaster('#f4f2ee', 0.08), floor: () => planksRandom(['#e5d5bd', '#dccaae', '#e9dcc6', '#e0cfb5'], 'rgba(120,90,50,.28)') },
  natural: { wall: plaster('#e8dccb'), floor: () => planksRandom(OAK, 'rgba(80,50,20,.35)') },
  nordic: { wall: plaster('#f7f7f5', 0.06), floor: () => widePlank(['#dedbd4', '#d5d2ca', '#e5e2dc', '#cfcbc3'], 'rgba(60,60,60,.25)') },
  modern: { wall: paint('#8b8d90'), floor: () => herringbone(['#4a3a2f', '#3f3128', '#544238', '#463527'], 'rgba(0,0,0,.45)') },
  classic: { wall: wainscot('#f1ede6', '#fbfaf7'), floor: () => herringbone(OAK, 'rgba(80,50,20,.4)') },
  french: { wall: brick((t) => `rgb(${Math.round(244 * t)},${Math.round(241 * t)},${Math.round(236 * t)})`, '#d8d4cd'), floor: () => chevron(OAK, 'rgba(80,50,20,.4)') },
  industrial: { wall: concreteWall(), floor: () => mortar() },
  midcentury: { wall: paint('#c8724f'), floor: () => parquet(['#a87a4e', '#9a6d43', '#b5875a', '#8f6540'], 'rgba(60,35,10,.4)') },
  japanese: { wall: juraku(), floor: (mats) => tatami('#1e2a22', mats) },
  hotel: { wall: paint('#2b3a55'), floor: () => carpet('#4a4a4f') },
  bath: { wall: tiles('#f7f7f5'), floor: () => terrazzo() },
  country: { wall: boards(['#e2c69a', '#d9bb8c', '#e8cea4', '#d2b482'], 'rgba(90,60,20,.3)'), floor: () => widePlank(['#6e4b30', '#61412a', '#7a5537', '#583b26'], 'rgba(0,0,0,.4)') },
};

/** テンプレートの床と壁を描く。呼ぶたびに描き直すので、部屋の大きさが変わったら呼び直す */
export function buildInteriorTextures(template: InteriorTemplateId, room: RoomSize, mats: TatamiMats): InteriorTextures {
  const recipe = RECIPES[template];
  const [floorCanvas, repeat] = recipe.floor(mats)(room, seeded(7));
  const floor = new THREE.CanvasTexture(floorCanvas);
  floor.colorSpace = THREE.SRGBColorSpace;
  floor.wrapS = floor.wrapT = THREE.RepeatWrapping;
  floor.repeat.set(repeat[0], repeat[1]);
  floor.anisotropy = 8;
  const [wall, wallTileWidth] = recipe.wall(room, seeded(11));
  return { floor, wall, wallTileWidth };
}
