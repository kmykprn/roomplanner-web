/**
 * 切り抜き画像を「板」として置く（ビルボード）。
 *
 * 3D モデルの代わりに、透過 PNG を貼った 1 枚の板を置く。板は常にカメラのほうを向く
 * （faceCamera）。部屋モードでカメラを回しても、板の薄さが見えて嘘がばれないようにするため。
 * 写真モードはカメラが固定なので、正面を向いたままになる。
 *
 * 向き（rotationY）は 3D と同じ値を持つが、板では**左右反転**として効く。
 * 90°〜270° の側を向いているなら裏返す。これで「向きを変える」操作が板でも意味を持つ。
 *
 * 足元にぼかした楕円を敷く。板は影を落とさない（薄いので落としても線にしかならない）ので、
 * 代わりの接地感。写真モードでも同じものが写真の上に乗る
 */

import * as THREE from 'three';

const textureLoader = new THREE.TextureLoader();

/** 楕円の影の大きさ（板の幅に対する比）と濃さ */
const SHADOW_WIDTH_RATIO = 0.9;
const SHADOW_DEPTH_RATIO = 0.28;
const SHADOW_OPACITY = 0.35;

/** 板の名前。faceCamera と outline の付け替えで探すのに使う */
export const BILLBOARD_NAME = 'billboard';

/**
 * 切り抜き画像を読み、指定の箱に収めた板を返す。
 *
 * @param url      切り抜き PNG の URL（Blob URL）
 * @param fitSize  [幅, 高さ, 奥行き] メートル。縦横比を保って幅と高さに収める
 */
export async function loadBillboard(
  url: string,
  fitSize: [number, number, number]
): Promise<THREE.Group> {
  const texture = await textureLoader.loadAsync(url);
  // 写真の色をそのまま出す。既定の LinearSRGB のままだと白っぽく浮く
  texture.colorSpace = THREE.SRGBColorSpace;
  // 縮小時のギザつきを抑える。ミップマップは透過の縁をにじませるので使わない
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;

  const aspect = texture.image.width / texture.image.height;
  const scale = Math.min(fitSize[0] / aspect, fitSize[1]);
  const width = aspect * scale;
  const height = scale;

  const group = new THREE.Group();
  group.name = BILLBOARD_NAME;

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      // 完全に透明な画素は深度にも書かない。書くと、後ろにある家具が四角く隠れる
      alphaTest: 0.02,
      side: THREE.DoubleSide,
      // 写真はもう「見た目の色」なので、レンダラーのトーンマッピングを通さない
      toneMapped: false,
    })
  );
  // 底面基準。足元が y = 0 に来る
  plane.position.y = height / 2;
  plane.name = 'billboard-plane';
  group.add(plane);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(plane.geometry),
    new THREE.LineBasicMaterial({ color: 0x0a7ea4 })
  );
  outline.position.y = height / 2;
  outline.name = 'outline';
  outline.visible = false;
  group.add(outline);

  group.add(createFloorShadow(width));

  return group;
}

/** 足元のぼかした楕円。中心が濃く、縁へ向かって消える */
function createFloorShadow(width: number): THREE.Mesh {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 32),
    new THREE.MeshBasicMaterial({
      map: radialGradientTexture(),
      transparent: true,
      opacity: SHADOW_OPACITY,
      // 深度に書かない。書くと床の上でちらつく（同じ高さの面どうしで取り合う）
      depthWrite: false,
      toneMapped: false,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  // 床にぴったりだと床と取り合うので、わずかに浮かせる
  shadow.position.y = 0.002;
  shadow.scale.set(width * SHADOW_WIDTH_RATIO, width * SHADOW_DEPTH_RATIO, 1);
  shadow.name = 'floor-shadow';
  return shadow;
}

/** 中心が黒く縁が透明な円。1 度作って使い回す */
let gradientTexture: THREE.CanvasTexture | null = null;
function radialGradientTexture(): THREE.CanvasTexture {
  if (gradientTexture) return gradientTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.5)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  gradientTexture = new THREE.CanvasTexture(canvas);
  return gradientTexture;
}

/**
 * 板をカメラのほうへ向ける。毎フレーム呼ぶ。
 *
 * 向くのは水平方向だけ（Y 軸まわり）。上下まで向けると、見下ろしたときに板が寝て
 * 床に沈んで見える。親（家具の group）の向きは rotationY で決まっているので、
 * その分を差し引いてカメラの方向を出す。裏返し（左右反転）は親の向きから決める。
 *
 * 傾き（tilt）は Z 軸まわり。Euler の既定 XYZ は Ry × Rz の順に掛かるので、
 * 「カメラを向いてから、その面の中で回す」になる
 */
export function faceCamera(billboard: THREE.Object3D, camera: THREE.Camera, tilt = 0): void {
  const parent = billboard.parent;
  if (!parent) return;
  const position = new THREE.Vector3();
  parent.getWorldPosition(position);
  const toCamera = camera.position.clone().sub(position);
  const yaw = Math.atan2(toCamera.x, toCamera.z);
  billboard.rotation.set(0, yaw - parent.rotation.y, tilt);
  // 「向き」が 90°〜270° の側なら裏返す。cos の符号で見れば範囲の折り返しを考えずに済む
  billboard.scale.x = Math.cos(parent.rotation.y) < 0 ? -1 : 1;
}
