/**
 * 写真の上に落ちる影。
 *
 * **写真そのものには触れない。** キャンバスは `alpha: true` で、写真は CSS の背景として
 * キャンバスの下に敷いてある。キャンバスに半透明の黒を描けば、下の写真が暗くなる。
 *
 * 影を受ける面は **y=0 の水平な面**、つまり「床に合わせる」で向きを決めている
 * あの床そのもの。新しく決めるものは無い。`ShadowMaterial` は影の落ちたところだけ
 * 暗くなり、それ以外は完全に透明なので、面をどれだけ広げても何も見えない。
 *
 * 決めていないものが 1 つだけある。**写真の中で光がどこから来ているか。**
 * ここでは左斜め上から当てている。
 */

import * as THREE from 'three';

/**
 * 光の向き（床の上の位置）。左・上・少し手前。
 * 影は反対側（右・奥）へ伸びる
 */
const LIGHT_POSITION: [number, number, number] = [-3, 4, 1];

/** 影の濃さ。濃いと写真から浮き、薄いと接地が伝わらない */
const SHADOW_OPACITY = 0.55;

/**
 * 影の色。
 *
 * 真っ黒にすると写真から浮く。実際の室内の影は、周りの壁や天井から回り込む光で
 * 埋められるので、真っ黒にはならず、少し青みがかった濃い灰色になる
 */
const SHADOW_COLOR = 0x000000;

/** 影を受ける面の広さ（m）。透明なので広くても困らない */
const CATCHER_SIZE = 40;

/** 影を計算する範囲（m）。狭いと影が切れ、広いと同じ解像度を配るのでぼやける */
const SHADOW_EXTENT = 8;

export function createPhotoShadow(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'photo-shadow';
  group.visible = false;

  // **明るさは 0 にする。** ここで欲しいのは影だけで、物を照らす必要はない
  // （写真モードの家具は光を当てないマテリアルで描いている）。
  // 影は castShadow で決まり、明るさとは関係しない
  const light = new THREE.DirectionalLight(0xffffff, 0);
  light.position.set(...LIGHT_POSITION);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.02;

  const shadowCamera = light.shadow.camera;
  shadowCamera.left = -SHADOW_EXTENT;
  shadowCamera.right = SHADOW_EXTENT;
  shadowCamera.top = SHADOW_EXTENT;
  shadowCamera.bottom = -SHADOW_EXTENT;
  shadowCamera.near = 0.1;
  shadowCamera.far = SHADOW_EXTENT * 4;
  shadowCamera.updateProjectionMatrix();

  const catcher = new THREE.Mesh(
    new THREE.PlaneGeometry(CATCHER_SIZE, CATCHER_SIZE),
    new THREE.ShadowMaterial({ color: SHADOW_COLOR, opacity: SHADOW_OPACITY })
  );
  catcher.rotation.x = -Math.PI / 2;
  catcher.receiveShadow = true;

  group.add(light, light.target, catcher);
  return group;
}
