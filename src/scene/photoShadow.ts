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
 * **影は家具について回る。** 写真モードの家具は上下にドラッグすると宙に浮く
 * （写真の中の奥行きは決まらないので、画面に沿って動かすため）。浮いた家具の影を
 * 床（y=0）に落とすと、影だけが背景のずっと奥に取り残されて見える。
 * そこで、**家具ごとに「その家具が乗っている面」を用意して、そこへ影を落とす。**
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

/** 床（y=0）に敷く面の広さ（m）。透明なので広くても困らない */
const CATCHER_SIZE = 40;

/**
 * 家具ごとに敷く面の広さ（m）。
 *
 * **こちらは広くしない。** 広げると、別の家具の影まで拾ってしまう。
 * 影が伸びる長さ（家具の高さと同じくらい）を覆えれば足りる
 */
const ITEM_CATCHER_SIZE = 3;

/** これより高く浮いている家具にだけ、専用の面を敷く（床に乗っているものは床の面で足りる） */
const FLOATING_THRESHOLD = 0.01;

/** 影を計算する範囲（m）。狭いと影が切れ、広いと同じ解像度を配るのでぼやける */
const SHADOW_EXTENT = 8;

export interface PhotoShadow {
  group: THREE.Group;
  /**
   * 宙に浮いている家具の足元に、影を受ける面を敷き直す。
   * 家具が動くたびに呼ぶ
   */
  setFloatingItems(positions: [number, number, number][]): void;
}

export function createPhotoShadow(): PhotoShadow {
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

  /**
   * 家具ごとの面。要る数だけ作って使い回す。
   * 作り直すと、動かしている間ずっと GPU 上の形が入れ替わる
   */
  const itemCatchers: THREE.Mesh[] = [];

  function setFloatingItems(positions: [number, number, number][]): void {
    const floating = positions.filter(([, y]) => y > FLOATING_THRESHOLD);

    while (itemCatchers.length < floating.length) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(ITEM_CATCHER_SIZE, ITEM_CATCHER_SIZE),
        // 材質は床の面と分ける。共有すると、濃さを変えたときに両方が動いてしまう
        new THREE.ShadowMaterial({ color: SHADOW_COLOR, opacity: SHADOW_OPACITY })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.receiveShadow = true;
      itemCatchers.push(mesh);
      group.add(mesh);
    }

    itemCatchers.forEach((mesh, index) => {
      const at = floating[index];
      mesh.visible = Boolean(at);
      if (at) mesh.position.set(at[0], at[1], at[2]);
    });
  }

  return { group, setFloatingItems };
}
