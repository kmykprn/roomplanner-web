/**
 * 床を合わせるときに置く「薄い板」。
 *
 * **形にはねらいがある。**
 *
 *   床に寝ている物      … 板の上面が、そのまま「いま決めている床の面」になる。
 *                         浮いている・傾いていることが、面として見える
 *   比べる相手が床にある … 板の辺を**フローリングの目地や壁際の線**と見比べられる。
 *                         視線が床の中で完結する（コーンは壁の角まで目を往復させていた）
 *   面積が広い          … 手前の辺と奥の辺の縮み方の違いが出るので、見下ろし角のずれが見える
 *   厚みがある          … 側面の縦の辺が見えるので、左右の傾きも読める
 *
 * 最初は三角コーンだったが、板のほうが上の点で読みやすかったので置き換えた。
 *
 * 置く場所は**画面の決まった一点**（床の上の決まった場所ではない）。世界の座標に固定すると、
 * 傾きを変えたときに板が画面から逃げていき、利用者が板を追いかける羽目になる。
 */

import * as THREE from 'three';

/** 板の大きさ（m）。畳の半分ほど。大きすぎると床が見えず、小さいと傾きが読めない */
const SLAB = { width: 0.9, depth: 0.6, thickness: 0.06 };

/**
 * 画面の上での大きさをそろえるための、基準の距離（m）。
 *
 * **傾けても板の大きさが変わらないようにする。** 画面の同じ点を指していても、
 * 傾きによって床までの距離は変わる。そのままだと板が膨らんだり縮んだりして、
 * 動かすたびに大きさが暴れる。距離に比例して板を拡縮すれば、見た目の大きさが揃う。
 * 2.5m は、見下ろし角 22° のときに出ていた距離（その大きさが扱いやすかった）
 */
const REFERENCE_DISTANCE = 2.5;

/** 目印の色。触れている間は明るくする（変化が無いと、効いているのか分からない） */
const IDLE = 0x18b4e0;
const ACTIVE = 0x7ae4ff;

/**
 * 板の不透明さ。
 *
 * **透けると床に乗って見えない。** 向こう側が見えている物は、目には浮いている物に映る。
 * 実物が床にあるなら、その下の床は隠れる。完全には塗りつぶさないのは、
 * 板を置いた場所の床の様子も少しは見えたほうが、位置を決めやすいため
 */
const SLAB_OPACITY = 0.82;

/**
 * 板の下に敷く影の広がり（板の何倍か）と濃さ。
 *
 * **接地している感じは、影がいちばん強く作る。** 板そのものをいくら描き込んでも、
 * 床との境目に影が無いと浮いて見える。写真は CSS の背景なので、
 * 黒い面を薄く重ねて暗くする（写真そのものには触らない）
 */
const SHADOW_SPREAD = 1.9;
const SHADOW_OPACITY = 0.5;

/**
 * 床の面をどれだけの広さ塗るか（m）。触れている間だけ出す。
 * **広く取る。** 狭いと面の奥の端が画面に出てしまい、壁のように見える
 */
const TINT_SIZE = 24;

/** 床の面。カメラから伸ばした視線がここに当たった場所に板を置く */
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export interface FloorMarkers {
  group: THREE.Group;
  /** カメラの向きと、板を置く場所に合わせて置き直す。どちらかが変わるたびに呼ぶ */
  update(camera: THREE.Camera, probe: { x: number; y: number }): void;
  /** その画面の点が板の上か。指の動きを「板を動かす」と「傾きを変える」に振り分けるのに使う */
  hitsSlab(camera: THREE.Camera, point: { x: number; y: number }): boolean;
  /** 指が触れているかを伝える。触れている間は色を変え、床の面を出す */
  setActive(active: boolean): void;
}

export function createFloorMarkers(): FloorMarkers {
  const group = new THREE.Group();
  group.name = 'floor-markers';
  group.visible = false;

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(SLAB.width, SLAB.thickness, SLAB.depth),
    // depthWrite を切らない。切ると板の向こう側の面や辺まで透けて、箱の形が読めなくなる。
    // 面をわずかに奥へずらすのは、同じ位置にある白い辺が面に負けて消えるのを防ぐため
    new THREE.MeshBasicMaterial({
      color: IDLE,
      transparent: true,
      opacity: SLAB_OPACITY,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    })
  );
  slab.position.y = SLAB.thickness / 2;

  // 床との境目に敷く影。板より一回り広く、外へ向かってぼかす
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(SLAB.width * SHADOW_SPREAD, SLAB.depth * SHADOW_SPREAD),
    new THREE.MeshBasicMaterial({
      map: createShadowTexture(),
      transparent: true,
      opacity: SHADOW_OPACITY,
      depthWrite: false,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.001;

  // 辺を白く描く。**辺を床の目地と見比べる**のがこの形のねらいなので、辺がはっきり見えること
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(slab.geometry),
    new THREE.LineBasicMaterial({ color: 0xffffff })
  );
  edges.position.y = SLAB.thickness / 2;

  const marker = new THREE.Group();
  // 影を先に足す。あとから足すと、薄い板より手前に描かれて板が曇る
  marker.add(shadow, slab, edges);

  // 触れている間だけ出す床の面。面が動いているのが見える
  const tint = new THREE.Mesh(
    new THREE.PlaneGeometry(TINT_SIZE, TINT_SIZE),
    new THREE.MeshBasicMaterial({ color: IDLE, transparent: true, opacity: 0.12, depthWrite: false })
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
    // 傾けるたびに板が画面の上へずれていく
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(new THREE.Vector2(probe.x, probe.y), camera);
    // 床より上を向いている視線は当たらない。そのときは板を出さない
    const found = raycaster.ray.intersectPlane(FLOOR, hit);
    marker.visible = Boolean(found);
    if (!found) return;
    marker.position.copy(hit);
    // 遠いほど大きくして、画面の上での大きさを一定に保つ
    marker.scale.setScalar(camera.position.distanceTo(hit) / REFERENCE_DISTANCE);
  }

  function hitsSlab(camera: THREE.Camera, point: { x: number; y: number }): boolean {
    if (!marker.visible) return false;
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(new THREE.Vector2(point.x, point.y), camera);
    return raycaster.intersectObject(slab, false).length > 0;
  }

  function setActive(active: boolean): void {
    tint.visible = active;
    slab.material.color.setHex(active ? ACTIVE : IDLE);
  }

  return { group, update, setActive, hitsSlab };
}

/**
 * 影の濃さの分布を描いた画像を作る。
 *
 * **輪郭をぼかす。** くっきりした黒い四角を敷くと、影ではなく「もう 1 枚の板」に見える。
 * 真ん中を濃く、外へ向かって薄くすると、床に落ちた影として読める
 */
function createShadowTexture(): THREE.Texture {
  const SIZE = 128;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext('2d');
  if (context) {
    const half = SIZE / 2;
    const gradient = context.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    // 板の縁のあたりまでは濃さを保ち、そこから外だけを薄くする
    gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.85)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, SIZE, SIZE);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
