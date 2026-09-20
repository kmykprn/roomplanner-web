/**
 * 写真の中の「現実で垂直な縁」を人に選んでもらい、そこから床の傾きを出す。
 *
 * 壁の角・ドア枠・窓枠は、現実ではすべて同じ向き（重力の向き）を向いている。
 * そういう線は写真の上では 1 点に集まるので、**2 本あれば撮影時の傾きが決まる**。
 *
 * **どれが本物の垂直かは人に決めてもらう。** 自動で選ぶとカーテンのひだに負ける
 * （furniture3d の docs/08-floor-fit.md に実測がある）。人が押す前提なら、
 * 計算そのものは交点を出すだけなので外しようがない。
 *
 * 合成データで確かめたこと。
 *
 *   ・見下ろし 0〜40°・左右 ±20° の 25 通りを、誤差 0.0000° で復元する
 *   ・左右の傾きは画角の仮定に影響されない（焦点距離を ±25% 変えても変わらない）
 *   ・見下ろし角だけが影響を受け、±25% で約 3°
 *   ・縁のたどりが ±2px ずれても、傾きは 0.2° しか動かない
 */

import { detectVerticalLines, traceEdgeAt, type EdgeLine } from '@/core/edgeLines';
import { poseFromVerticals } from '@/core/verticalPose';
import type { FloorFit } from '@/core/floorFit';
import type { PhotoPoint } from '@/core/photoView';

/**
 * 写真の中の線分。座標は**写真の中の割合**（左上が 0, 右下が 1）。
 *
 * 画素で持たない理由は、寄ったり画面が回ったりしても同じ線を指したいため。
 * 画素で持つと、読み込む大きさを変えただけで線がずれる
 */
export interface PhotoEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * 縁を探すときに読み込む写真の長辺（画素）。
 *
 * 縁の検出は中でさらに 480px まで縮めるので、これ以上大きくしても精度は変わらない。
 * 小さすぎると、押した場所と縁のずれが目立つ
 */
const WORK_SIZE = 1200;

/**
 * 画角の仮定（対角）。スマホの標準カメラのだいたいの値。
 *
 * **左右の傾きには影響しない。見下ろし角だけに効く。** ここが ±25% ずれると
 * 見下ろし角が約 3° ずれる。水平な縁も押してもらえば、この仮定は要らなくなる
 */
const ASSUMED_DIAGONAL_FOV_DEG = 79;

/** 読み込んだ写真の画素。写真が変わるまで使い回す */
interface Pixels {
  url: string;
  data: ImageData;
}
let cached: Pixels | null = null;

/** 写真の画素を用意する。同じ写真なら 2 回目以降はすぐ返る */
async function pixelsFor(url: string): Promise<ImageData | null> {
  if (cached?.url === url) return cached.data;

  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    return null;
  }

  const scale = Math.min(1, WORK_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(2, Math.round(image.naturalWidth * scale));
  const height = Math.max(2, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);

  cached = { url, data: context.getImageData(0, 0, width, height) };
  return cached.data;
}

/** 押せる候補の縁を集める。写真が読めなければ空 */
export async function findEdgeCandidates(url: string): Promise<PhotoEdge[]> {
  const pixels = await pixelsFor(url);
  if (!pixels) return [];
  return detectVerticalLines(pixels).map((line) => toPhotoEdge(line, pixels));
}

/**
 * 押された場所の縁をたどって 1 本の線にする。
 *
 * @param reach 1 で普通。大きいほど弱い縁も追い、長く伸びる（「もっと伸ばす」用）
 */
export async function traceEdgeAtPoint(
  url: string,
  point: PhotoPoint,
  reach = 1
): Promise<PhotoEdge | null> {
  const pixels = await pixelsFor(url);
  if (!pixels) return null;
  const line = traceEdgeAt(pixels, point.x * pixels.width, point.y * pixels.height, reach);
  return line ? toPhotoEdge(line, pixels) : null;
}

/**
 * 選ばれた 2 本から床の傾きを出す。
 *
 * 2 本そろっていない、または 2 本が画面の上で近すぎるときは null。
 * 近い 2 本は、わずかなずれで交点が大きく動くので答えにならない
 */
export function fitFromEdges(edges: PhotoEdge[], aspect: number): FloorFit | null {
  if (edges.length < 2) return null;
  // 縦横比だけ分かればよいので、幅を 1000 と置いて画素の座標に直す
  const width = 1000;
  const height = width / aspect;
  const focal =
    Math.hypot(width, height) /
    (2 * Math.tan((ASSUMED_DIAGONAL_FOV_DEG * Math.PI) / 180 / 2));
  const [a, b] = edges.slice(-2).map((edge) => toPixelLine(edge, width, height));
  return poseFromVerticals(a, b, focal, width, height)?.fit ?? null;
}

/** 写真が変わったら、覚えている画素を捨てる */
export function forgetPhotoPixels(): void {
  cached = null;
}

function toPhotoEdge(line: EdgeLine, pixels: ImageData): PhotoEdge {
  return {
    x1: line.x1 / pixels.width,
    y1: line.y1 / pixels.height,
    x2: line.x2 / pixels.width,
    y2: line.y2 / pixels.height,
  };
}

function toPixelLine(edge: PhotoEdge, width: number, height: number): EdgeLine {
  return {
    x1: edge.x1 * width,
    y1: edge.y1 * height,
    x2: edge.x2 * width,
    y2: edge.y2 * height,
    support: 0,
  };
}
