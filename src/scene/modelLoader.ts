/**
 * GLB モデルの読み込みと、部屋の座標系への適合。
 *
 * GLB は作られ方によって大きさも原点の位置もばらばらなので、
 * そのまま置くと巨大だったり床に埋まったりする。
 * このモジュールが「指定サイズに収まる・底面が y=0 に来る」形に整えてから返す。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SURFACES } from '@/config/theme';

const loader = new GLTFLoader();

/**
 * 同じモデルを何度も置くことがあるので、一度読んだものは使い回す。
 * 3MB を超えるファイルもあるため、毎回取りに行くと待たされる。
 */
const cache = new Map<string, Promise<THREE.Group>>();

/**
 * GLB を読み込み、指定サイズに収めた複製を返す。
 *
 * @param url       public/ からのパス
 * @param fitSize   [幅, 高さ, 奥行き] メートル。この箱に収まるよう等倍で縮める
 */
export async function loadFurnitureModel(
  url: string,
  fitSize: [number, number, number]
): Promise<THREE.Group> {
  // 配信先によって置き場所が変わる（GitHub Pages はサブパス配下）ため、
  // ビルド時のベースパスを前に付けて絶対的な位置を決める
  const resolvedUrl = import.meta.env.BASE_URL + url;

  let entry = cache.get(resolvedUrl);
  if (!entry) {
    entry = loader.loadAsync(resolvedUrl).then((gltf) => gltf.scene);
    cache.set(resolvedUrl, entry);
  }

  // 使う側が自由に動かせるよう、キャッシュの原本ではなく複製を渡す
  const model = (await entry).clone(true);
  prepareForRoom(model, fitSize);
  return model;
}

/**
 * 読み込んだモデルを部屋の座標系に合わせる。
 *
 * v4 と同じく、縦横の比率は保ったまま指定サイズに収める
 * （軸ごとに別々の倍率をかけると家具が歪むため）。
 */
function prepareForRoom(model: THREE.Object3D, fitSize: [number, number, number]): void {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());

  // 3 軸のうち最も窮屈な倍率に合わせれば、指定の箱に必ず収まる
  const scale = Math.min(fitSize[0] / size.x, fitSize[1] / size.y, fitSize[2] / size.z);
  model.scale.setScalar(scale);

  // 縮めたあとの位置を測り直し、底面が y=0、左右奥行きの中心が原点に来るようずらす。
  // このアプリのオブジェクトはすべて底面基準（config/room.ts 参照）
  const scaledBox = new THREE.Box3().setFromObject(model);
  const center = scaledBox.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -scaledBox.min.y, -center.z);

  applySceneSettings(model);
}

/** 影の設定と、質感の補正をモデル全体にかける */
function applySceneSettings(model: THREE.Object3D): void {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    child.castShadow = true;
    child.receiveShadow = true;

    // 写真から起こしたモデルはつやが強すぎて内装に馴染まないことがあるため、
    // 金属でないものは家具らしいざらつきに寄せる
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (material.metalness > 0.5) continue; // 本当に金属のものはそのまま
      material.roughness = Math.max(material.roughness, SURFACES.furniture.roughness);
      material.metalness = 0;
    }
  });
}
