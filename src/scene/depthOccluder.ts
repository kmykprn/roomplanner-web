/**
 * 写真の中で家具より手前にある物の、見えない面（写真モードだけ）。
 *
 * **色は描かず、奥行きだけを書く。** 写真の奥行きの地図から、写真に写っている物の表面を 3D の面にして、
 * 家具より先に描く。この面より奥にある家具の部分は描かれないので、下に敷いた写真がそのまま見え、
 * 写真の中の机やソファが家具の手前に出る。手で塗る範囲（ui/maskPanel.ts）は、この上から足す。
 *
 * 面はカメラの座標で作り、写真を描いているカメラと同じ位置・向きに置く（interaction/photoCamera.ts）。
 * 奥行きの地図の 1 点が、写真の同じ点に写るようにするため。
 *
 * CG の部屋の画像 120 枚で、家具の見える・隠れるの取り違えは、見える側と隠れる側の平均で 14% 前後だった。
 * 奥行きの地図の輪郭が粗いので、手前の物の縁は少しずれる
 */

import * as THREE from 'three';

import type { DepthMap } from '@/core/depthModel';
import type { DepthScale, Lens } from '@/core/depthPlacement';

/**
 * 面を、写っている物よりこの距離（m）だけ奥へ下げる。
 * 下げないと、床に置いた家具の足元が床の面に埋もれて欠ける（奥行きの誤差で、床の面が手前に来る所がある）。
 * 10 cm と 15 cm を比べ、取り違えの少なかった 10 cm にした
 */
export const PUSH_BACK = 0.1;

/**
 * 隣どうしの奥行きがこの比より離れている所は、物の縁とみなし、手前の奥行きに寄せる。
 * 奥行きの地図は物の縁でぼやけ、手前の物が細く出る。縁を 1 画素ぶん手前の物に寄せると、取り違えが減った
 */
const EDGE_RATIO = 1.12;

/** 面の細かさ（奥行きの地図の何画素ごとに頂点を置くか） */
const STEP = 2;

export interface OccluderSource {
  map: DepthMap;
  scale: DepthScale;
  lens: Lens;
}

/** 隠さずに手前に描く家具の箱（3D の位置・大きさ・向き） */
export interface FrontBox {
  position: [number, number, number];
  size: [number, number, number];
  rotationY: number;
}

/** ステンシルに書く印。手前に描く家具の箱が写る画素に付け、隠す面はそこに奥行きを書かない */
const FRONT_STENCIL = 1;
/** 手前に描く家具の箱を、家具より少しだけ大きくする割合（縁が隠れて見えないように） */
const FRONT_MARGIN = 1.05;

export interface DepthOccluder {
  group: THREE.Group;
  /** 手前に描く家具の箱の入れ物（3D の座標に置く。カメラには付いて行かない） */
  frontGroup: THREE.Group;
  /** 隠さずに手前に描く家具の箱を入れ替える */
  setFrontBoxes(boxes: FrontBox[]): void;
  /** 面を作り直す。null なら面を外す。同じ中身なら何もしない */
  setSource(source: OccluderSource | null): void;
  /** 写真を描いているカメラと同じ位置・向きに置く */
  followCamera(camera: THREE.Camera): void;
}

export function createDepthOccluder(): DepthOccluder {
  const group = new THREE.Group();
  group.name = 'depthOccluder';
  // 色を書かず、奥行きだけを書く。家具より先に描く。
  // 手前に描く家具の箱が写る画素（ステンシルの印がある所）には書かない。そこでは家具が写真の物に隠れない
  const material = new THREE.MeshBasicMaterial({
    colorWrite: false,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: FRONT_STENCIL,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilWriteMask: 0,
  });
  let mesh: THREE.Mesh | null = null;
  let current: OccluderSource | null = null;

  function setSource(source: OccluderSource | null): void {
    if (sameSource(current, source)) return;
    current = source;
    if (mesh) {
      group.remove(mesh);
      mesh.geometry.dispose();
      mesh = null;
    }
    if (!source) return;
    mesh = new THREE.Mesh(buildGeometry(source), material);
    mesh.renderOrder = -10;
    group.add(mesh);
  }

  /**
   * 手前に描く家具の箱。色も奥行きも書かず、写る画素にステンシルの印だけを付ける。隠す面より先に描く。
   * 奥行きを見ないので、写真の物の奥にあっても印が付く
   */
  const frontGroup = new THREE.Group();
  frontGroup.name = 'frontBoxes';
  const frontMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: FRONT_STENCIL,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  });
  const frontGeometry = new THREE.BoxGeometry(1, 1, 1);
  let frontKey = '';

  function setFrontBoxes(boxes: FrontBox[]): void {
    const key = JSON.stringify(boxes);
    if (key === frontKey) return;
    frontKey = key;
    frontGroup.clear();
    for (const box of boxes) {
      const mesh = new THREE.Mesh(frontGeometry, frontMaterial);
      const [w, h, d] = box.size;
      mesh.scale.set(w * FRONT_MARGIN, h * FRONT_MARGIN, d * FRONT_MARGIN);
      // 箱は底面の中心が原点（家具と同じ）
      mesh.position.set(box.position[0], box.position[1] + h / 2, box.position[2]);
      mesh.rotation.y = box.rotationY;
      mesh.renderOrder = -20;
      frontGroup.add(mesh);
    }
  }

  function followCamera(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    group.position.copy(camera.position);
    group.quaternion.copy(camera.quaternion);
  }

  return { group, frontGroup, setFrontBoxes, setSource, followCamera };
}

function sameSource(a: OccluderSource | null, b: OccluderSource | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.map === b.map &&
    a.scale.a === b.scale.a &&
    a.scale.b === b.scale.b &&
    a.lens.vfovDeg === b.lens.vfovDeg &&
    a.lens.aspect === b.lens.aspect
  );
}

/**
 * 面に使う奥行き。直し方を当て、物の縁を手前に寄せる（まわり 3×3 の最大と最小が EDGE_RATIO より離れていれば最小）。
 * 分からない所は NaN のまま
 */
export function occluderDepths(map: DepthMap, scale: DepthScale): Float32Array {
  const { width, height, data } = map;
  const scaled = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 1) scaled[i] = scale.a * data[i] + scale.b;
  const result = new Float32Array(data.length);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      let low = Infinity;
      let high = -Infinity;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const y = row + dy;
          const x = column + dx;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const value = scaled[y * width + x];
          if (!Number.isFinite(value)) continue;
          if (value < low) low = value;
          if (value > high) high = value;
        }
      }
      const index = row * width + column;
      result[index] = high / low > EDGE_RATIO ? low : scaled[index];
    }
  }
  return result;
}

/** 奥行きの地図の点を、カメラの座標の頂点にして、隣どうしを三角形でつなぐ。奥行きの分からない点を含む三角形は作らない */
function buildGeometry({ map, scale, lens }: OccluderSource): THREE.BufferGeometry {
  const depths = occluderDepths(map, scale);
  const columns = Math.ceil(map.width / STEP);
  const rows = Math.ceil(map.height / STEP);
  const t = Math.tan((lens.vfovDeg * Math.PI) / 360);
  const positions = new Float32Array(columns * rows * 3);
  const valid = new Uint8Array(columns * rows);
  for (let r = 0; r < rows; r += 1) {
    const row = Math.min(r * STEP, map.height - 1);
    for (let c = 0; c < columns; c += 1) {
      const column = Math.min(c * STEP, map.width - 1);
      const depth = depths[row * map.width + column];
      const vertex = r * columns + c;
      if (!(depth > 0)) continue;
      // 視線（正面の奥行きが 1 になる長さ）。depthPlacement.ts の rayOf と同じ
      const rx = (((column + 0.5) / map.width) * 2 - 1) * t * lens.aspect;
      const ry = (1 - ((row + 0.5) / map.height) * 2) * t;
      // 視線に沿って PUSH_BACK だけ奥へ下げる
      const pushed = depth + PUSH_BACK / Math.hypot(rx, ry, 1);
      positions[vertex * 3] = rx * pushed;
      positions[vertex * 3 + 1] = ry * pushed;
      positions[vertex * 3 + 2] = -pushed;
      valid[vertex] = 1;
    }
  }
  const indices: number[] = [];
  for (let r = 0; r + 1 < rows; r += 1) {
    for (let c = 0; c + 1 < columns; c += 1) {
      const a = r * columns + c;
      const b = a + 1;
      const d = a + columns;
      const e = d + 1;
      if (valid[a] && valid[d] && valid[b]) indices.push(a, d, b);
      if (valid[b] && valid[d] && valid[e]) indices.push(b, d, e);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
