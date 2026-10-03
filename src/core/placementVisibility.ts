/**
 * 家具が、写真に写っている物の奥に入って隠れる割合を見積もる（新しく置く場所を決めるときに使う）。
 *
 * 隠す仕組み（scene/depthOccluder.ts）と同じ奥行き（直し方・縁の寄せ方・10 cm の余裕）で判定する。
 * 家具の箱の、カメラから見える面（底以外で、カメラの方を向いている面）に点を並べ、
 * その点が写る写真の画素の、写真の物までの距離より遠い点を「隠れる」と数える
 */

import type { DepthMap } from '@/core/depthModel';
import { photoPointOf, type DepthScale, type Lens, type PhotoPose } from '@/core/depthPlacement';
import { PUSH_BACK, occluderDepths } from '@/scene/depthOccluder';

type Vec = [number, number, number];

/** 箱の面ごとに並べる点の数（一辺） */
const SAMPLES_PER_SIDE = 8;

export interface VisibilitySource {
  map: DepthMap;
  scale: DepthScale;
  lens: Lens;
}

/**
 * 隠れる割合（0〜1）を返す関数を作る。奥行きの準備（縁の寄せ方など）は 1 回だけ行い、
 * 置く場所の候補を何度も試せるようにする。写真の外に写る点は数えない
 */
export function createHiddenShare(
  source: VisibilitySource,
  pose: PhotoPose
): (position: Vec, size: Vec, rotationY: number) => number {
  const { map, lens } = source;
  const depths = occluderDepths(map, source.scale);
  const t = Math.tan((lens.vfovDeg * Math.PI) / 360);
  const [cx, cy, cz] = pose.position;

  return (position, size, rotationY) => {
    const [w, h, d] = size;
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    // 家具の座標（底面の中心が原点）→ 3D の座標
    const toWorld = (x: number, y: number, z: number): Vec => [
      position[0] + x * cos + z * sin,
      position[1] + y,
      position[2] - x * sin + z * cos,
    ];
    // 底以外の 5 面。面の中心・法線（家具の座標）・面の上の 2 方向
    const faces: Array<{ center: Vec; normal: Vec; u: Vec; v: Vec }> = [
      { center: [0, h, 0], normal: [0, 1, 0], u: [w, 0, 0], v: [0, 0, d] },
      { center: [0, h / 2, d / 2], normal: [0, 0, 1], u: [w, 0, 0], v: [0, h, 0] },
      { center: [0, h / 2, -d / 2], normal: [0, 0, -1], u: [w, 0, 0], v: [0, h, 0] },
      { center: [w / 2, h / 2, 0], normal: [1, 0, 0], u: [0, 0, d], v: [0, h, 0] },
      { center: [-w / 2, h / 2, 0], normal: [-1, 0, 0], u: [0, 0, d], v: [0, h, 0] },
    ];
    let total = 0;
    let hidden = 0;
    for (const face of faces) {
      const centerWorld = toWorld(...face.center);
      const normal = toWorld(...face.normal);
      const normalWorld: Vec = [normal[0] - position[0], normal[1] - position[1], normal[2] - position[2]];
      // カメラの方を向いていない面は、家具自身に隠れて見えないので数えない
      const facing = normalWorld[0] * (cx - centerWorld[0]) + normalWorld[1] * (cy - centerWorld[1]) + normalWorld[2] * (cz - centerWorld[2]);
      if (facing <= 0) continue;
      for (let i = 0; i < SAMPLES_PER_SIDE; i += 1) {
        for (let j = 0; j < SAMPLES_PER_SIDE; j += 1) {
          // 面の端（床に接する下の端も）まで並べる。脚の先のように細く低い所が隠れるのも見逃さない
          const a = i / (SAMPLES_PER_SIDE - 1) - 0.5;
          const b = j / (SAMPLES_PER_SIDE - 1) - 0.5;
          const point = toWorld(
            face.center[0] + face.u[0] * a + face.v[0] * b,
            face.center[1] + face.u[1] * a + face.v[1] * b,
            face.center[2] + face.u[2] * a + face.v[2] * b
          );
          const photo = photoPointOf(point, lens, pose);
          if (!photo || photo.x < 0 || photo.x >= 1 || photo.y < 0 || photo.y >= 1) continue;
          total += 1;
          const column = Math.min(map.width - 1, Math.floor(photo.x * map.width));
          const row = Math.min(map.height - 1, Math.floor(photo.y * map.height));
          const depth = depths[row * map.width + column];
          if (!(depth > 0)) continue;
          // 写真の物までの距離（隠す面と同じく、視線に沿って PUSH_BACK だけ奥）と、家具の点までの距離
          const rayLength = Math.hypot((photo.x * 2 - 1) * t * lens.aspect, (1 - photo.y * 2) * t, 1);
          const photoDistance = depth * rayLength + PUSH_BACK;
          const furnitureDistance = Math.hypot(point[0] - cx, point[1] - cy, point[2] - cz);
          if (furnitureDistance > photoDistance) hidden += 1;
        }
      }
    }
    return total === 0 ? 0 : hidden / total;
  };
}
