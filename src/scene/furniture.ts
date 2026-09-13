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
import { BILLBOARD_NAME, faceCamera, loadBillboard } from '@/scene/billboard';
import { resolveModelUrl } from '@/platform/modelCache';
import { resolveCutoutUrl } from '@/platform/cutoutCache';

export interface FurnitureLayer {
  group: THREE.Group;
  /** レイキャスト対象にする家具本体のメッシュ一覧 */
  pickables(): THREE.Object3D[];
  sync(furniture: PlacedFurniture[], selectedId: string | null): void;
  /** 切り抜きの板をカメラのほうへ向ける。毎フレーム呼ぶ。板が無ければ何もしない */
  faceCamera(camera: THREE.Camera): void;
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
      applySize(object, item.size);

      // 選択枠は子として持たせてあるので、表示を切り替えるだけでよい
      const outline = object.getObjectByName('outline');
      if (outline) outline.visible = item.id === selectedId;
    }
  }

  return {
    group,
    // 当たり判定は基本は仮の箱。切り抜きの板は箱より細いので、板が入ったらそちらに替える
    pickables: () =>
      [...objects.values()].map(
        (object) => (object.userData.pickable as THREE.Object3D | undefined) ?? object.children[0]
      ),
    sync,
    faceCamera(camera) {
      for (const object of objects.values()) {
        const billboard = object.getObjectByName(BILLBOARD_NAME);
        if (billboard) faceCamera(billboard, camera);
      }
    },
  };
}

/**
 * 大きさの変化を、作り直さずに拡大率で追従させる。
 *
 * 箱もモデルも作ったときの大きさで組んであり、あとから変えると作り直し
 * （GLB なら読み直し）になる。大きさは3辺そろえて変えるので、作ったときの
 * 大きさとの比を group に掛けるだけで足りる。原点が足元なので、拡大しても
 * 足は床に付いたまま
 */
function applySize(object: THREE.Group, size: [number, number, number]): void {
  const builtWidth = object.userData.builtWidth as number;
  object.scale.setScalar(size[0] / builtWidth);
}

function createFurnitureObject(item: PlacedFurniture): THREE.Group {
  const object = new THREE.Group();
  const [width, height, depth] = item.size;
  // 拡大率の基準。あとで大きさが変わったとき、これとの比で拡大する
  object.userData.builtWidth = width;

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

  // GLB や切り抜きを持つ家具は、読み込めたら箱と差し替える。
  // 読み込みを待たずに箱を先に見せるので、置いた瞬間の反応が遅くならない。
  // 両方あれば 3D を優先する（切り抜きを後から 3D にしたもの）
  if (item.modelUrl) {
    // 写真から生成した家具。端末に保存した中身を URL にしてから読む
    resolveModelUrl(item.modelUrl).then((url) => {
      if (url) replaceWithModel(object, mesh, url, item.size);
      // 見つからなければ箱のまま。端末のデータが消された場合など
    });
  } else if (item.imageUrl) {
    resolveCutoutUrl(item.imageUrl).then((url) => {
      if (url) replaceWithBillboard(object, mesh, outline, url, item);
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

/**
 * 仮の箱を切り抜きの板に差し替える。
 *
 * 3D と違い、当たり判定も選択枠も板のものに替える。箱（1m 四方）のままだと、
 * 細長い家具の横の何も無い場所を押しても選ばれてしまう。
 * 前の URL は読み終わったら解放する（テクスチャは GPU に上がっている）
 */
function replaceWithBillboard(
  object: THREE.Group,
  placeholder: THREE.Mesh,
  boxOutline: THREE.Object3D,
  url: string,
  item: PlacedFurniture
): void {
  loadBillboard(url, item.size)
    .then((billboard) => {
      URL.revokeObjectURL(url);
      // 読み込み中に家具が消されていたら、シーンに足さず捨てる
      if (!object.parent) return;

      placeholder.visible = false;
      placeholder.castShadow = false;
      placeholder.receiveShadow = false;
      // 選択枠は板のものに替える。箱の枠は名前を外して、sync が板の枠を見つけられるようにする
      boxOutline.visible = false;
      boxOutline.name = '';
      const plane = billboard.getObjectByName('billboard-plane');
      if (plane) {
        plane.userData.furnitureId = item.id;
        object.userData.pickable = plane;
      }
      object.add(billboard);
    })
    .catch((error) => {
      URL.revokeObjectURL(url);
      console.error(`切り抜きの読み込みに失敗しました: ${item.imageUrl}`, error);
    });
}

/** GPU 上のメモリを解放する。消しっぱなしにすると使用量が増え続ける */
function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.LineSegments)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      // 切り抜きのテクスチャは家具ごとに持っている（使い回していない）ので、ここで捨てる
      if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
      material.dispose();
    }
  });
}
