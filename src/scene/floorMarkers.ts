/**
 * 床を合わせるときに置く「見本の椅子」。
 *
 * **誰でも正しい姿を知っている物を置く。** 椅子がまっすぐ立って床に着いていれば
 * 床は合っている。傾いていれば、脚が床にめり込んだり浮いたりして一目で分かる。
 * 板や三角コーンだと「そういう形なのかもしれない」と思えてしまい、判断がつかない。
 *
 * **影も一緒に見る。** 4 本の脚の下に影があれば床に着いている。影が脚から離れていれば
 * 浮いている（scene/photoShadow.ts）。接地しているかどうかは、影がいちばん強く語る。
 *
 * 置く場所は**画面の決まった一点**（床の上の決まった場所ではない）。世界の座標に固定すると、
 * 傾きを変えたときに椅子が画面から逃げていき、利用者が椅子を追いかける羽目になる。
 */

import * as THREE from 'three';

import chairModel from '@/assets/furniture/chair.glb?url';
import { loadFurnitureModel } from '@/scene/modelLoader';

/** 見本に使うモデルと、その実寸（m）。「家具」タブのサンプル 1 と同じもの */
const SAMPLE = { url: chairModel, size: [0.46, 0.9, 0.5] as [number, number, number] };

/**
 * 見本を床の上で回しておく角度。
 *
 * **正面から見せない。** 真正面だと後ろの脚が前の脚に隠れて、床に着いている点が
 * 2 つしか見えない。斜めにすると 4 本とも見え、接地点が四隅に散るので、
 * 床に乗っているかどうかが読みやすくなる
 */
const SAMPLE_TURN = Math.PI / 4;

/**
 * 画面の上での大きさをそろえるための、基準の距離（m）。
 *
 * **傾けても椅子の大きさが変わらないようにする。** 画面の同じ点を指していても、
 * 傾きによって床までの距離は変わる。そのままだと椅子が膨らんだり縮んだりして、
 * 動かすたびに大きさが暴れる。距離に比例して拡縮すれば、見た目の大きさが揃う。
 * 2.5m は、見下ろし角 22° のときに出ていた距離（その大きさが扱いやすかった）
 */
const REFERENCE_DISTANCE = 2.5;

const TINT_COLOR = 0x18b4e0;

/**
 * 床の面をどれだけの広さ塗るか（m）。触れている間だけ出す。
 * **広く取る。** 狭いと面の奥の端が画面に出てしまい、壁のように見える
 */
const TINT_SIZE = 24;

/** 床の面。カメラから伸ばした視線がここに当たった場所に椅子を置く */
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export interface FloorMarkers {
  group: THREE.Group;
  /** カメラの向きと、椅子を置く場所に合わせて置き直す。どちらかが変わるたびに呼ぶ */
  update(camera: THREE.Camera, probe: { x: number; y: number }): void;
  /** その画面の点が椅子の上か。指の動きを「椅子を動かす」と「傾きを変える」に振り分けるのに使う */
  hitsMarker(camera: THREE.Camera, point: { x: number; y: number }): boolean;
  /** 指が触れているかを伝える。触れている間は色を変え、床の面を出す */
  setActive(active: boolean): void;
}

export function createFloorMarkers(): FloorMarkers {
  const group = new THREE.Group();
  group.name = 'floor-markers';
  group.visible = false;

  const marker = new THREE.Group();
  marker.rotation.y = SAMPLE_TURN;

  /**
   * 指で掴む相手。**見えない箱にする。**
   * 細かいモデルに毎回光線を当てると重く、脚の隙間を狙わせるのも酷なので、
   * 当たり判定は椅子をすっぽり包む箱で取る（家具の掴み方と同じ考え）
   */
  const grabBox = new THREE.Mesh(
    new THREE.BoxGeometry(...SAMPLE.size),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  grabBox.position.y = SAMPLE.size[1] / 2;
  marker.add(grabBox);

  // 見本の椅子。読み込めるまでは何も出さない（仮の箱を出すと、それが目印に見えてしまう）
  loadFurnitureModel(SAMPLE.url, SAMPLE.size)
    .then((model) => marker.add(model))
    .catch((error) => {
      console.error('床合わせの見本を読み込めませんでした', error);
    });

  // 触れている間だけ出す床の面。面が動いているのが見える
  const tint = new THREE.Mesh(
    new THREE.PlaneGeometry(TINT_SIZE, TINT_SIZE),
    new THREE.MeshBasicMaterial({ color: TINT_COLOR, transparent: true, opacity: 0.12, depthWrite: false })
  );
  tint.rotation.x = -Math.PI / 2;
  tint.position.y = 0.002;
  tint.visible = false;

  group.add(marker, tint);

  const raycaster = new THREE.Raycaster();
  const hit = new THREE.Vector3();

  function update(camera: THREE.Camera, probe: { x: number; y: number }): void {
    // **回したばかりのカメラは、まだ行列に反映されていない。**
    // 更新せずに視線を出すと、1 つ前の向きで位置を決めてしまい、
    // 傾けるたびに椅子が画面の上へずれていく
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(new THREE.Vector2(probe.x, probe.y), camera);
    // 床より上を向いている視線は当たらない。そのときは椅子を出さない
    const found = raycaster.ray.intersectPlane(FLOOR, hit);
    marker.visible = Boolean(found);
    if (!found) return;
    marker.position.copy(hit);
    // 遠いほど大きくして、画面の上での大きさを一定に保つ
    marker.scale.setScalar(camera.position.distanceTo(hit) / REFERENCE_DISTANCE);
  }

  function hitsMarker(camera: THREE.Camera, point: { x: number; y: number }): boolean {
    if (!marker.visible) return false;
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(new THREE.Vector2(point.x, point.y), camera);
    return raycaster.intersectObject(grabBox, false).length > 0;
  }

  /**
   * 指が触れている間は床の面を出す。
   *
   * **椅子そのものの色は変えない。** モデルのマテリアルは読み込みの使い回しで、
   * 同じ椅子を家具として置いてある場合と共有している。ここで色を変えると
   * そちらまで変わってしまう（scene/furniture.ts の sharedAssets を参照）
   */
  function setActive(active: boolean): void {
    tint.visible = active;
  }

  return { group, update, setActive, hitsMarker };
}
