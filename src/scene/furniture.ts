/**
 * 家具を 3D シーンに反映する層。
 *
 * appState.furniture（ただの配列）と three.js のオブジェクトを突き合わせて、
 * 増えたら足す・減ったら消す・変わったら位置を更新する、それだけ。
 * React の差分描画が裏でやっていたことを、目に見える形で書いている。
 *
 * 家具はすべて「底面基準」で作る（config/room.ts の座標系仕様を参照）。
 * グループの原点が底面なので、position.y = 0 が床置きになる。
 */

import * as THREE from 'three';
import { findFurnitureType, type PlacedFurniture } from '@/config/furniture';
import { SCENE_COLORS, SURFACES } from '@/config/theme';
import { loadFurnitureModel } from '@/scene/modelLoader';
import { resolveModelUrl } from '@/platform/modelCache';

export interface FurnitureLayer {
  group: THREE.Group;
  /** レイキャスト対象にする家具本体のメッシュ一覧 */
  pickables(): THREE.Object3D[];
  sync(furniture: PlacedFurniture[], selectedId: string | null): void;
}

export function createFurnitureLayer(): FurnitureLayer {
  const group = new THREE.Group();
  const objects = new Map<string, THREE.Group>();

  function sync(furniture: PlacedFurniture[], selectedId: string | null): void {
    const liveIds = new Set(furniture.map((item) => item.id));

    // 状態から消えた家具をシーンからも取り除く
    for (const [id, object] of objects) {
      if (liveIds.has(id)) continue;
      group.remove(object);
      disposeObject(object);
      objects.delete(id);
    }

    for (const item of furniture) {
      let object = objects.get(item.id);
      if (!object) {
        object = createFurnitureObject(item);
        objects.set(item.id, object);
        group.add(object);
      }

      object.position.set(...item.position);
      object.rotation.y = item.rotationY;

      // 選択枠は子として持たせてあるので、表示を切り替えるだけでよい
      const outline = object.getObjectByName('outline');
      if (outline) outline.visible = item.id === selectedId;
    }
  }

  return {
    group,
    pickables: () => [...objects.values()].map((object) => object.children[0]),
    sync,
  };
}

function createFurnitureObject(item: PlacedFurniture): THREE.Group {
  const object = new THREE.Group();
  const [width, height, depth] = item.size;

  const geometry = new THREE.BoxGeometry(width, height, depth);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: item.color, ...SURFACES.furniture })
  );

  // 底面基準にするため、ボックスの中心を高さの半分だけ持ち上げる
  mesh.position.y = height / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // レイキャストで当たったメッシュから家具 ID を引けるようにしておく
  mesh.userData.furnitureId = item.id;
  object.add(mesh);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: SCENE_COLORS.selection })
  );
  outline.position.y = height / 2;
  outline.name = 'outline';
  outline.visible = false;
  object.add(outline);

  // GLB を持つ家具は、読み込めたら箱と差し替える。
  // 読み込みを待たずに箱を先に見せるので、置いた瞬間の反応が遅くならない
  if (item.modelUrl) {
    // 写真から生成した家具。端末に保存した中身を URL にしてから読む
    resolveModelUrl(item.modelUrl).then((url) => {
      if (url) replaceWithModel(object, mesh, url, item.size);
      // 見つからなければ箱のまま。端末のデータが消された場合など
    });
  } else {
    const type = findFurnitureType(item.typeId);
    if (type?.modelPath) {
      replaceWithModel(object, mesh, type.modelPath, item.size);
    }
  }

  return object;
}

/**
 * 仮の箱を GLB モデルに差し替える。
 *
 * レイキャストの対象は箱のまま（子として抱える）にしてある。
 * 高ポリゴンのモデルに毎回光線を当てると重く、
 * また凹凸のある形は指で狙いにくいため、当たり判定は箱のほうが具合がよい。
 */
function replaceWithModel(
  object: THREE.Group,
  placeholder: THREE.Mesh,
  modelPath: string,
  size: [number, number, number]
): void {
  loadFurnitureModel(modelPath, size)
    .then((model) => {
      // 読み込み中に家具が消されていたら、シーンに足さず捨てる
      if (!object.parent) return;

      placeholder.visible = false;
      placeholder.castShadow = false;
      placeholder.receiveShadow = false;
      object.add(model);
    })
    .catch((error) => {
      // 読み込めなくても箱のまま操作は続けられるので、落とさず記録に留める
      console.error(`家具モデルの読み込みに失敗しました: ${modelPath}`, error);
    });
}

/** GPU 上のメモリを解放する。消しっぱなしにすると使用量が増え続ける */
function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.LineSegments)) return;
    child.geometry.dispose();
    const material = child.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
  });
}
