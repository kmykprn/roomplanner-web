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
 * **面はどちらか一方だけ出す。** 両方出すと、浮いた家具が足元と床の 2 か所に
 * 影を落とす。足元のほうは合っているが、床のほうが見当違いの場所に出る。
 *
 *   床を合わせている間 … 見本は必ず床の上にいるので、床の面だけ
 *   ふだんの家具配置   … 家具は床の上にいるとは限らないので、家具ごとの面だけ
 *
 * 決めていないものが 1 つだけある。**写真の中で光がどこから来ているか。**
 * ここではほぼ真上から当てている。向きを外す危険がいちばん小さい。
 */

import * as THREE from 'three';

/**
 * 光の向き（床の上の位置）。**ほぼ真上。**
 *
 * 斜めから当てると、物の上のほうの影ほど横へずれて落ちる。天板の影が脚から離れて
 * 「もう 1 つの影」に見えたのはこれ。真上からなら影は物の真下にまとまり、
 * 脚の影と天板の影が重なって 1 つになる。
 *
 * 完全な真上（x=0, z=0）にしないのは、光の向きと「上」が平行になって
 * カメラの向きが決められなくなるのを避けるため。この程度のずれなら、
 * 高さ 1m の物でも影は 3cm しか動かない
 */
const LIGHT_POSITION: [number, number, number] = [0.2, 6, 0.2];

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

/** 家具ごとに敷く面の形の大きさ（m）。実際の大きさは家具に合わせて拡大・縮小する */
const ITEM_CATCHER_SIZE = 1;
/**
 * 家具ごとの面を、上から見た家具の長い辺（幅と奥行きの大きいほう）の何倍にするか。
 *
 * **その家具の影だけを受けるよう、足元を少し超える程度にとどめる。** 面を広げると、
 * 近くの別の家具（とくに持ち上げた家具）の影まで拾い、その家具から離れた床に四角い影が出た。
 * 真上に近い光なので、影は足元の輪郭とほぼ同じ。回した家具でも輪郭が収まるよう √2 倍より少し広くする
 */
const ITEM_CATCHER_RATIO = 1.5;

/** 影を計算する範囲（m）。狭いと影が切れ、広いと同じ解像度を配るのでぼやける */
const SHADOW_EXTENT = 8;

export interface PhotoShadow {
  group: THREE.Group;
  /**
   * 影を受ける面を敷き直す。家具が動くたび、姿が変わるたびに呼ぶ。
   *
   * @param fittingFloor 床を合わせている最中か。true なら床の面だけを出す
   * @param items 家具の足元の位置と大きさ。床を合わせている間は使わない
   */
  setGrounds(fittingFloor: boolean, items: GroundItem[]): void;
}

export interface GroundItem {
  position: [number, number, number];
  size: [number, number, number];
}

/**
 * 影を受ける面の材質。影の落ちた所だけ暗くなり、ほかは透明。
 *
 * **奥行き（深度バッファ）は書かない。** 透明でも書くと、面より低い所にある物（ほかの家具の脚など）が
 * 上から見下ろすカメラからは面の向こうにあるとみなされて描かれず、四角く切り取られた（ShadowMaterial の既定は書く）
 */
function createCatcherMaterial(): THREE.ShadowMaterial {
  return new THREE.ShadowMaterial({ color: SHADOW_COLOR, opacity: SHADOW_OPACITY, depthWrite: false });
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

  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(CATCHER_SIZE, CATCHER_SIZE), createCatcherMaterial());
  catcher.rotation.x = -Math.PI / 2;
  catcher.receiveShadow = true;

  group.add(light, light.target, catcher);

  /**
   * 家具ごとの面。要る数だけ作って使い回す。
   * 作り直すと、動かしている間ずっと GPU 上の形が入れ替わる
   */
  const itemCatchers: THREE.Mesh[] = [];

  function setGrounds(fittingFloor: boolean, items: GroundItem[]): void {
    catcher.visible = fittingFloor;
    const grounds = fittingFloor ? [] : items;

    while (itemCatchers.length < grounds.length) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(ITEM_CATCHER_SIZE, ITEM_CATCHER_SIZE),
        // 材質は床の面と分ける。共有すると、濃さを変えたときに両方が動いてしまう
        createCatcherMaterial()
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.receiveShadow = true;
      itemCatchers.push(mesh);
      group.add(mesh);
    }

    itemCatchers.forEach((mesh, index) => {
      const item = grounds[index];
      mesh.visible = Boolean(item);
      if (!item) return;
      mesh.position.set(...item.position);
      // 上から見た長い辺に合わせて、足元を少し超える大きさにする
      const side = Math.max(item.size[0], item.size[2]) * ITEM_CATCHER_RATIO;
      mesh.scale.setScalar(side / ITEM_CATCHER_SIZE);
    });
  }

  return { group, setGrounds };
}
