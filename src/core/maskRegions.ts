/**
 * 家具より手前に表示する範囲（マスク）を、物ごとの「見えない板」にする。
 *
 * **囲った物だけが家具を隠し、隠すのは家具がその物より奥にあるときだけ。**
 * 前はマスクの形で写真を切り抜き、いつも家具の上に重ねていた。それだと、ソファの手前に置いた椅子までソファに隠れた。
 * 写真の奥行きから手前の物を自動で見つける仕組みもあったが、隠す物をアプリが決めるので、
 * 写真の物に重ねて置きたいときに置けず、置くたびに隠れない場所を探すことになった。
 *
 * 作り方:
 *   1. マスクを、つながった塊に分ける（ソファを囲った範囲と、植物を塗った範囲は別の塊）
 *   2. 塊のいちばん下の点を、その物が床に接する所とみなし、家具を置くときと同じやり方で 3D の位置を出す
 *   3. その位置に、カメラの方を向いた縦の板を立てる。塊の中の画素の奥行きは、その板までの奥行きにする
 * いちばん下が地平線より上にある塊（窓・吊り棚など、床に接していない物）は、床の位置が出せないので、
 * 今までどおりいつも家具の手前に出す。
 *
 * できた奥行きの地図は、写真の奥行きと同じ形（正面方向の奥行き）なので、隠す面（scene/depthOccluder.ts）と
 * 隠れる割合の見積もり（core/placementVisibility.ts）にそのまま渡せる
 */

import type { DepthMap } from '@/core/depthModel';
import { worldRayOf, type Lens, type PhotoPose } from '@/core/depthPlacement';
import type { PhotoPoint } from '@/core/photoView';

type Vec = [number, number, number];

/** 塊に分けるときのマスクの解像度（長辺、画素）。板の縁の細かさはこれで決まる */
export const REGION_LONG_EDGE = 512;

/** マスクの画素を「塗ってある」とみなす不透明度（0〜255） */
const ALPHA_THRESHOLD = 128;

/**
 * 床に接していない塊の板を置く、正面方向の奥行き（m）。カメラのすぐ前に置き、どの家具よりも手前にする
 * （隠す面はさらに 10 cm 奥へ下がるが、それでもカメラの描く範囲の手前の端 0.1 m より奥に収まる）
 */
const ALWAYS_FRONT_DEPTH = 0.05;

export interface MaskRegions {
  width: number;
  height: number;
  /** 画素ごとの塊の番号。0 は塊の外、塊は 1 から */
  labels: Int32Array;
  /** 塊ごとのいちばん下の点（写真の割合）。番号 n の塊は bottoms[n - 1] */
  bottoms: PhotoPoint[];
}

/**
 * マスクの画素（RGBA）を、上下左右でつながった塊に分ける。
 * 塊のいちばん下の点は、いちばん下の行の、塗ってある画素の横の真ん中
 */
export function labelMaskRegions(rgba: Uint8ClampedArray, width: number, height: number): MaskRegions {
  const labels = new Int32Array(width * height);
  const bottoms: PhotoPoint[] = [];
  const stack = new Int32Array(width * height);
  for (let start = 0; start < labels.length; start += 1) {
    if (labels[start] !== 0 || rgba[start * 4 + 3] < ALPHA_THRESHOLD) continue;
    const label = bottoms.length + 1;
    let bottomRow = -1;
    let bottomSum = 0;
    let bottomCount = 0;
    let size = 0;
    stack[size++] = start;
    labels[start] = label;
    while (size > 0) {
      const index = stack[--size];
      const row = Math.floor(index / width);
      const column = index - row * width;
      if (row > bottomRow) {
        bottomRow = row;
        bottomSum = 0;
        bottomCount = 0;
      }
      if (row === bottomRow) {
        bottomSum += column;
        bottomCount += 1;
      }
      const visit = (next: number): void => {
        if (labels[next] !== 0 || rgba[next * 4 + 3] < ALPHA_THRESHOLD) return;
        labels[next] = label;
        stack[size++] = next;
      };
      if (column > 0) visit(index - 1);
      if (column < width - 1) visit(index + 1);
      if (row > 0) visit(index - width);
      if (row < height - 1) visit(index + width);
    }
    bottoms.push({ x: (bottomSum / bottomCount + 0.5) / width, y: (bottomRow + 1) / height });
  }
  return { width, height, labels, bottoms };
}

/**
 * 塊ごとの板までの奥行きの地図。塊の外は NaN（隠さない）。
 * footOf は写真の点に写っている床の 3D の位置（家具を置くときと同じやり方）。床が写らない点なら null
 */
export function regionDepthMap(
  regions: MaskRegions,
  lens: Lens,
  pose: PhotoPose,
  footOf: (point: PhotoPoint) => Vec | null
): DepthMap {
  const { width, height, labels } = regions;
  const [cx, , cz] = pose.position;
  // 塊ごとの板。足元の点を通り、カメラの方を向いた縦の面（法線は水平）。床が出せなければ null（いつも手前）
  const planes = regions.bottoms.map((bottom) => {
    const foot = footOf(bottom);
    if (!foot) return null;
    const nx = cx - foot[0];
    const nz = cz - foot[2];
    const length = Math.hypot(nx, nz);
    if (!(length > 0)) return null;
    return { foot, normal: [nx / length, 0, nz / length] as Vec };
  });
  const data = new Float32Array(width * height).fill(NaN);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      const label = labels[index];
      if (label === 0) continue;
      const plane = planes[label - 1];
      if (!plane) {
        data[index] = ALWAYS_FRONT_DEPTH;
        continue;
      }
      // 視線（正面方向の奥行きが 1 の長さ）が板と交わるまでの長さが、そのまま正面方向の奥行き
      const ray = worldRayOf({ x: (column + 0.5) / width, y: (row + 0.5) / height }, lens, pose.fit);
      const { foot, normal } = plane;
      const toward = normal[0] * ray[0] + normal[2] * ray[2];
      const along = normal[0] * (foot[0] - pose.position[0]) + normal[2] * (foot[2] - pose.position[2]);
      const depth = along / toward;
      // 板と交わらない視線（板と平行・板の後ろ向き）は、隠さない
      data[index] = depth > 0 && Number.isFinite(depth) ? depth : NaN;
    }
  }
  return { width, height, data };
}

/** マスクの画像を、塊に分ける。読めなければ null */
export async function loadMaskRegions(url: string): Promise<MaskRegions | null> {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    return null;
  }
  const scale = Math.min(1, REGION_LONG_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  return labelMaskRegions(context.getImageData(0, 0, width, height).data, width, height);
}
