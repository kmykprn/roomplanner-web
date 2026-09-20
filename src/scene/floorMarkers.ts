/**
 * 床を合わせるときに立てる三角コーン。
 *
 * **形にはねらいがある。**
 *
 *   立っているのが当たり前の形 … 傾いていると「倒れかけている」とすぐ読める。
 *                                 立方体や方眼だと、傾いていても「そういう形」に見えてしまう
 *   回しても同じに見える       … 床の上での向き（ヨー）を合わせる作業だと誤解させない
 *   実際の大きさで置く         … 大きさが変なら、高さの決め打ちが合っていないことにも気づける
 *
 * 置く場所は**画面の決まった 3 か所**（床の上の決まった場所ではない）。
 * 世界の座標に固定すると、傾きを変えたときにコーンが画面から逃げていき、
 * 利用者がコーンを追いかける羽目になる（実機で確認）。
 * 画面に固定すれば、**同じ場所で形だけが変わる**ので見比べやすい。
 *
 * 利用者は**部屋の中の縦のもの（壁の角・家具の縁）と見比べて**、まっすぐ立つまで指で直す。
 */

import * as THREE from 'three';

/**
 * 大きさ（m）。実物の三角コーンより一回り小さくしてある。
 * 実寸どおりだと手前のものが画面を覆ってしまい、肝心の床が見えなくなる（実機で確認）
 */
const HEIGHT = 0.36;
const RADIUS = 0.12;

/**
 * 画面のどこに立てるか（-1〜+1 の座標。下が負）。
 * 床が写っていそうな下半分に、左右と奥行きを散らして置く
 */
const SPOTS: [number, number][] = [
  [-0.42, -0.34],
  [0.02, -0.52],
  [0.46, -0.2],
];

/** 床の面。カメラから伸ばした視線がここに当たった場所にコーンを立てる */
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const ORANGE = 0xf07018;
const WHITE = 0xfdfdfd;

export interface FloorMarkers {
  group: THREE.Group;
  /** カメラの向きに合わせて置き直す。傾きを変えるたびに呼ぶ */
  update(camera: THREE.Camera): void;
}

/** コーンの層を作る。`group` をシーンに足し、合わせている間だけ `visible` にする */
export function createFloorMarkers(): FloorMarkers {
  const group = new THREE.Group();
  group.name = 'floor-markers';
  group.visible = false;

  const cones = SPOTS.map(() => createCone());
  group.add(...cones);

  const raycaster = new THREE.Raycaster();
  const hit = new THREE.Vector3();

  function update(camera: THREE.Camera): void {
    // **回したばかりのカメラは、まだ行列に反映されていない。**
    // 更新せずに視線を出すと、1 つ前の向きで位置を決めてしまい、
    // 傾けるたびにコーンが画面の上へずれていく（実機で確認）
    camera.updateMatrixWorld(true);
    SPOTS.forEach(([x, y], index) => {
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      // 床より上を向いている視線は当たらない。そのコーンは出さない
      const found = raycaster.ray.intersectPlane(FLOOR, hit);
      cones[index].visible = Boolean(found);
      if (found) cones[index].position.copy(hit);
    });
  }

  return { group, update };
}

function createCone(): THREE.Object3D {
  const cone = new THREE.Group();

  // 光の当たり方で判断させたくないので、陰影の付かないマテリアルにする。
  // 「傾いているか」だけに目が向くほうがよい
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(RADIUS, HEIGHT, 28),
    new THREE.MeshBasicMaterial({ color: ORANGE })
  );
  body.position.y = HEIGHT / 2;

  // 白い帯。高さの途中に入れると、傾いたときに帯が斜めになって分かりやすい
  const band = new THREE.Mesh(
    new THREE.ConeGeometry(RADIUS * 0.62, HEIGHT * 0.18, 28, 1, true),
    new THREE.MeshBasicMaterial({ color: WHITE, side: THREE.DoubleSide })
  );
  band.position.y = HEIGHT * 0.62;

  // 底の座。床に接している面が見えると「乗っている」感じが出る
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(RADIUS * 1.25, RADIUS * 1.25, 0.02, 28),
    new THREE.MeshBasicMaterial({ color: ORANGE })
  );
  base.position.y = 0.01;

  cone.add(body, band, base);
  return cone;
}
