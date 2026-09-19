/**
 * GLB モデルの読み込みと、部屋の座標系への適合。
 *
 * GLB は作られ方によって大きさも原点の位置もばらばらなので、
 * そのまま置くと巨大だったり床に埋まったりする。
 * このモジュールが「指定サイズに収まる・底面が y=0 に来る」形に整えてから返す。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

/**
 * 同じモデルを何度も置くことがあるので、一度読んだものは使い回す。
 * 3MB を超えるファイルもあるため、毎回取りに行くと待たされる。
 */
const cache = new Map<string, Promise<THREE.Group>>();

/**
 * GLB を読み込み、指定サイズに収めた複製を返す。
 *
 * @param url       そのまま読める URL。基本の家具は Vite が取り込んだ URL（ベースパス込み）、
 *                  生成した家具は Blob から作った URL。ここでは何も足さない
 *                  （以前はベースパスを足していて、Pages では二重になり読めなかった）
 * @param fitSize   [幅, 高さ, 奥行き] メートル。この箱に収まるよう等倍で縮める
 */
export async function loadFurnitureModel(
  url: string,
  fitSize: [number, number, number]
): Promise<THREE.Group> {
  let entry = cache.get(url);
  if (!entry) {
    entry = loader.loadAsync(url).then((gltf) => {
      useBakedTexture(gltf.scene);
      return gltf.scene;
    });
    cache.set(url, entry);
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

/** 影の設定をモデル全体にかける。マテリアルは読み込み時に済ませてある（useBakedTexture） */
function applySceneSettings(model: THREE.Object3D): void {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    // 光を当てないマテリアルは影を受け取れない（受け取る先の陰影が無い）。
    // 落とす側は深度だけで決まるので、床に落ちる影はこれまでどおり出る
    child.castShadow = true;
  });
}

/**
 * 写真から起こしたモデルを、**光を当てずに**描くようにする。
 *
 * このアプリの 3D モデルは、どれも家具の写真から作られている。そのテクスチャは
 * **撮影したときの光がすでに入った色**で、部屋の光を掛ける前の色（アルベド）ではない。
 * そこへ部屋の光と環境光を掛けると光が二重になり、黒い家具が灰色に浮き、
 * 上を向いた面は環境光の天井を映して白く飛ぶ（実機で確認）。
 *
 * 入力写真との近さを 10 指標で測ったところ、**光を当てないのが 3 点とも最良**だった
 * （彩度とその分布。furniture3d の docs/07-appearance-metrics.md）。
 * 切り抜き（2D）の板も同じく光を当てていないので、2D と 3D で見え方も揃う。
 *
 * 読み込み時に一度だけ掛ける。**複製どうしはマテリアルを共有している**ので、
 * ここで差し替えれば、そのモデルを何個置いても描き方は揃う
 */
function useBakedTexture(model: THREE.Object3D): void {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const replaced = materials.map((material) => {
      if (!(material instanceof THREE.MeshStandardMaterial)) return material;
      // テクスチャが無いモデルは、色だけを引き継ぐ（真っ白になってしまうため）
      const unlit = new THREE.MeshBasicMaterial({
        map: material.map,
        color: material.color,
        vertexColors: material.vertexColors,
        transparent: material.transparent,
        opacity: material.opacity,
        alphaTest: material.alphaTest,
        side: material.side,
      });
      material.dispose(); // 差し替えたので元は要らない。テクスチャは unlit が引き継ぐので捨てない
      return unlit;
    });
    child.material = Array.isArray(child.material) ? replaced : replaced[0];
    // 使い回している中身なので、置いた家具を消すときに一緒に捨てない目印
    child.userData.sharedAssets = true;
  });
}
