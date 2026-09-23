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
import type { PlacedFurniture } from '@/config/furniture';
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

export interface FurnitureLayerOptions {
  /**
   * 中身（GLB や切り抜き）が読めて外形を測ったときに呼ぶ。外形はいま画面に出ている大きさ（m）。
   * 受け取る側は箱を中身の形に締め、実際の高さが決まっていればそれに合わせる（core/furnitureHeight.ts）
   */
  onMeasured?(itemId: string, bounds: [number, number, number]): void;
}

export function createFurnitureLayer({ onMeasured }: FurnitureLayerOptions = {}): FurnitureLayer {
  const group = new THREE.Group();
  const objects = new Map<string, THREE.Group>();

  /** 測った外形を、いまの倍率で m に直して知らせる */
  function reportBounds(object: THREE.Group, itemId: string, built: THREE.Vector3): void {
    if (!onMeasured) return;
    const scale = object.scale.x;
    onMeasured(itemId, [built.x * scale, built.y * scale, built.z * scale]);
  }

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
        object = createFurnitureObject(item, reportBounds);
        objects.set(item.id, object);
        group.add(object);
      }

      object.position.set(...item.position);
      // 向き（Y）を先に、前後の傾き（X）、左右の傾き（Z）をその向きの中で掛ける。
      // 原点は底面の中心なので、傾けると底の中心を支点に倒れる
      object.rotation.order = 'YXZ';
      object.rotation.set(item.pitch ?? 0, item.rotationY, item.roll ?? 0);
      // 板の傾き。板はカメラを向くときに毎フレーム向きを決め直すので、そこで一緒に効かせる
      object.userData.tilt = item.tilt ?? 0;
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
        if (billboard) faceCamera(billboard, camera, object.userData.tilt as number);
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

/** 中身の外形を知らせる関数。層（createFurnitureLayer）が持つので、ここまで渡す */
type ReportBounds = (object: THREE.Group, itemId: string, built: THREE.Vector3) => void;

function createFurnitureObject(item: PlacedFurniture, report: ReportBounds): THREE.Group {
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
      if (url) replaceWithModel(object, mesh, outline, url, item, report);
      // 見つからなければ箱のまま。端末のデータが消された場合など
    });
  } else if (item.imageUrl) {
    resolveCutoutUrl(item.imageUrl).then((url) => {
      if (url) replaceWithBillboard(object, mesh, outline, url, item, report);
    });
  }
  // どちらも無ければ箱のまま（古い記録に残っている基本の家具など）

  return object;
}

/**
 * 仮の箱を GLB モデルに差し替える。
 *
 * レイキャストの対象は箱のまま（子として抱える）にしてある。
 * 高ポリゴンのモデルに毎回光線を当てると重く、
 * また凹凸のある形は指で狙いにくいため、当たり判定は箱のほうが具合がよい。
 *
 * **箱はモデルが入ったところで、モデルの実際の大きさに締め直す。**
 * 理由は `fitBoundsToModel` を参照
 */
function replaceWithModel(
  object: THREE.Group,
  placeholder: THREE.Mesh,
  outline: THREE.Object3D,
  modelPath: string,
  item: PlacedFurniture,
  report: ReportBounds
): void {
  loadFurnitureModel(modelPath, item.size)
    .then((model) => {
      // 読み込み中に家具が消されていたら、シーンに足さず捨てる
      if (!object.parent) return;

      placeholder.visible = false;
      placeholder.castShadow = false;
      placeholder.receiveShadow = false;
      // シーンに足す前に測る。足したあとだと、家具の向きや大きさが混ざった値になる
      const measured = fitBoundsToModel(placeholder, outline, model);
      object.add(model);
      if (measured) {
        // 以後、状態の幅はこの締まった幅に対応する（状態側も締めた箱に書き替わる）
        object.userData.builtWidth = measured.x;
        report(object, item.id, measured);
      }
    })
    .catch((error) => {
      // 読み込めなくても箱のまま操作は続けられるので、落とさず記録に留める
      console.error(`家具モデルの読み込みに失敗しました: ${modelPath}`, error);
    });
}

/**
 * 選択枠と当たり判定の箱を、モデルの実際の大きさに合わせる。
 *
 * **指定の箱は「そこに収める先」でしかない。** モデルは縦横の比率を保ったまま
 * 収められる（scene/modelLoader.ts）ので、箱に接するのは 3 軸のうち 1 軸だけで、
 * 残りは必ず余る。写真から作った家具は実寸が分からず 1m の立方体に収めるため、
 * 余りがとくに大きい（実測では箱の体積の 3〜4 割しかモデルが入っていない）。
 *
 * 締め直すと、選択枠が家具の形に沿うだけでなく、**モデルから離れた何も無い場所を
 * 押しても掴めてしまう**のも直る。切り抜きの板では前から同じことをしている
 * （`replaceWithBillboard`）。
 */
function fitBoundsToModel(
  placeholder: THREE.Mesh,
  outline: THREE.Object3D,
  model: THREE.Object3D
): THREE.Vector3 | null {
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  // measure できない（中身が空、または読み違え）ときは、収める先の箱のままにしておく
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) return null;

  const center = bounds.getCenter(new THREE.Vector3());
  const box = new THREE.BoxGeometry(size.x, size.y, size.z);

  placeholder.geometry.dispose();
  placeholder.geometry = box;
  placeholder.position.copy(center);

  if (outline instanceof THREE.LineSegments) {
    outline.geometry.dispose();
    outline.geometry = new THREE.EdgesGeometry(box);
    outline.position.copy(center);
  }
  return size;
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
  item: PlacedFurniture,
  report: ReportBounds
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
      // 板の外形。奥行きは無いので、箱の奥行きを高さと同じ比率で縮めたものにする
      const plate = new THREE.Box3().setFromObject(billboard).getSize(new THREE.Vector3());
      if (plate.x > 0 && plate.y > 0) {
        plate.z = item.size[2] * (plate.y / item.size[1]);
        object.userData.builtWidth = plate.x;
        report(object, item.id, plate);
      }
    })
    .catch((error) => {
      URL.revokeObjectURL(url);
      console.error(`切り抜きの読み込みに失敗しました: ${item.imageUrl}`, error);
    });
}

/**
 * GPU 上のメモリを解放する。消しっぱなしにすると使用量が増え続ける。
 *
 * **GLB の中身は捨てない。** 読み込んだモデルは使い回し（scene/modelLoader.ts のキャッシュ）で、
 * 形もマテリアルもテクスチャも複製どうしで共有している。ここで捨てると、
 * 同じ家具をもう 1 つ置いてあるときにその見た目まで壊れる。
 * 目印は読み込み側が付けている（`userData.sharedAssets`）
 */
function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.LineSegments)) return;
    if (child.userData.sharedAssets) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      // 切り抜きのテクスチャは家具ごとに持っている（使い回していない）ので、ここで捨てる
      if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
      material.dispose();
    }
  });
}
