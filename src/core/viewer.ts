/**
 * three.js のレンダラー・シーン・カメラ・描画ループをまとめて作る。
 *
 * React Three Fiber と違い、ここで作ったオブジェクトは
 * 「その場で直接いじれる普通のオブジェクト」になる。
 * 状態を store に入れて再レンダリングを待つ必要がない。
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { THEME } from '@/config/theme';
import { viewOrigin, type PhotoView } from '@/core/photoView';

export interface Viewer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /**
   * 背景の写真を敷く層。**キャンバスとぴったり同じ矩形に置かれる。**
   *
   * 入れ物いっぱいに敷くと、寄ったときに写真だけがキャンバスの外へはみ出し、
   * 3D の描かれない場所に写真が見えてしまう
   */
  photoLayer: HTMLElement;
  /**
   * 隠す場所の層。キャンバスの**上**に、写真をマスクで切り抜いて重ねる。
   * 位置・大きさ・引き伸ばし方は写真の層とまったく同じにする。ずれると、
   * 隠した縁だけ写真が二重に見える
   */
  maskLayer: HTMLElement;
  /**
   * 描画範囲を指定の縦横比に収める。null で画面いっぱいに戻す。
   *
   * 写真モードで要る。写真は画面いっぱいには収まらない（縦横比が違う）ので
   * 余白ができるが、3D をその余白にまで描くと、写真の中の床と 3D の床が
   * 対応しなくなる。**写真が写っている矩形の中だけに描く。**
   */
  setContentAspect(aspect: number | null): void;

  /**
   * 写真のどこを、どれだけ寄って見るかを決める。null で全体に戻す。
   *
   * 写真は背景を引き伸ばし、3D は視錐台を切り取って、**同じ矩形**を出す。
   * 3D をキャンバスごと引き伸ばさないので、寄っても家具はボケない
   */
  setPhotoView(view: PhotoView | null): void;

  /** 毎フレーム呼ばれる処理を登録する */
  onFrame(callback: () => void): void;
  start(): void;
  dispose(): void;
}

/** 画面いっぱいに描くときの縦の画角（度）。写真モードでも部屋モードでも同じ */
const BASE_FOV = 50;

/**
 * 描画領域の高さに合わせた縦の画角。
 *
 * three.js は縦の画角を固定して描くので、1 m の物が画面に占める大きさは
 * **描画領域の高さに比例する。** 写真モードは描画領域を写真の縦横比に
 * 切り取るため、横長の写真を選ぶと高さが縮み、同じモデルが小さく見えていた
 * （写真を外すと元に戻る）。切り取った分だけ画角も狭めれば、
 * 画面いっぱいに描いたときと同じ大きさで描ける。
 */
function fovForDrawHeight(drawHeight: number, containerHeight: number): number {
  const halfBase = THREE.MathUtils.degToRad(BASE_FOV / 2);
  const halfFov = Math.atan(Math.tan(halfBase) * (drawHeight / containerHeight));
  return THREE.MathUtils.radToDeg(halfFov * 2);
}

export function createViewer(container: HTMLElement): Viewer {
  // alpha: true は写真モードのため。背景を CSS で敷いた写真に透かす。
  // 部屋モードは scene.background を色で塗るので、見た目は変わらない
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // モバイルで 3x は重いので上限を 2 に
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // 物理的に正しい明るさの範囲は 0〜1 に収まらないため、
  // そのまま出すと明るい部分が白く潰れる。フィルムのように滑らかに圧縮する
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  // 写真はキャンバスの下に敷く。キャンバスは alpha: true なので透けて見える。
  // 隠す場所の層はキャンバスの上。指の操作はキャンバスに通す（pointer-events: none）
  const photoLayer = document.createElement('div');
  photoLayer.className = 'viewport__photo';
  const maskLayer = document.createElement('div');
  maskLayer.className = 'viewport__mask';
  container.append(photoLayer, renderer.domElement, maskLayer);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(THEME.background);

  // 環境光マップ（IBL）。
  // 点光源だけだと影の側が真っ黒に落ちてプラスチックのように見えるが、
  // 「周囲から回り込む光」を与えると一気に実物らしくなる。
  // RoomEnvironment は three.js に同梱されたシンプルな室内環境なので、
  // HDRI 画像を別途ダウンロードせずに済む
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // 「周囲から回り込む光」の強さ。
  // 低くすると影の側に光が回らず、濃い色の家具が黒く沈んでしまう。
  // 部屋の中が実際の室内らしい明るさに見えるところまで上げている
  scene.environmentIntensity = 1.0;

  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 100);

  const frameCallbacks: Array<() => void> = [];

  /** 描画範囲の縦横比。null なら入れ物いっぱいに描く */
  let contentAspect: number | null = null;
  /** 写真のどこを見ているか。null なら切り取らない（部屋モード） */
  let photoView: PhotoView | null = null;
  /** いま描いている大きさ（CSS ピクセル）。写真をずらす量の計算に要る */
  let drawWidth = 0;
  let drawHeight = 0;

  function resize(): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    // 指定された縦横比に収める（写真と同じ「はみ出さずに全体を入れる」置き方）
    drawWidth = contentAspect ? Math.min(width, height * contentAspect) : width;
    drawHeight = contentAspect ? drawWidth / contentAspect : height;

    renderer.setSize(drawWidth, drawHeight, false);

    // キャンバスと写真の層を、同じ大きさ・同じ場所に重ねる。
    // 入れ物の中央に寄せる（CSS の 100% 指定より、ここで入れる値が優先される）
    for (const element of [renderer.domElement, photoLayer, maskLayer]) {
      const style = element.style;
      style.position = 'absolute';
      style.left = `${(width - drawWidth) / 2}px`;
      style.top = `${(height - drawHeight) / 2}px`;
      style.width = `${drawWidth}px`;
      style.height = `${drawHeight}px`;
    }

    camera.aspect = drawWidth / drawHeight;
    camera.fov = fovForDrawHeight(drawHeight, height);
    applyPhotoView();
  }

  /**
   * 見ている矩形を、写真と 3D の両方へ反映する。
   *
   * 写真は引き伸ばした背景をずらし、3D はカメラに同じ割合の切り取りを教える。
   * **どちらも同じ値から出す。**別々に持つと、寄ったときだけ家具が写真からずれる
   */
  function applyPhotoView(): void {
    if (!photoView) {
      camera.clearViewOffset(); // updateProjectionMatrix も中で呼ばれる
      setImageFit(photoLayer, '', '');
      setImageFit(maskLayer, '', '');
      return;
    }

    const { x, y } = viewOrigin(photoView);
    const visible = 1 / photoView.scale;

    // 全体を 1 × 1 として渡す。割合で持つので、画面の大きさが変わっても効き方は同じ
    camera.setViewOffset(1, 1, x, y, visible, visible);

    // 縦横の両方を指定する。片方を auto にすると、丸めの分だけ枠に隙間が出る
    const percent = `${photoView.scale * 100}%`;
    const size = `${percent} ${percent}`;
    const position = `${-x * photoView.scale * drawWidth}px ${-y * photoView.scale * drawHeight}px`;
    setImageFit(photoLayer, size, position);
    setImageFit(maskLayer, size, position);
  }

  /**
   * 写真の引き伸ばし方を層に入れる。
   * マスクの層は、写真（background）と切り抜き（mask）の両方を同じ値で動かす。
   * mask-* は Safari では接頭辞付きでしか効かない版があるので、両方入れる
   */
  function setImageFit(element: HTMLElement, size: string, position: string): void {
    const style = element.style;
    style.backgroundSize = size;
    style.backgroundPosition = position;
    for (const prefix of ['', '-webkit-']) {
      style.setProperty(`${prefix}mask-size`, size);
      style.setProperty(`${prefix}mask-position`, position);
    }
  }

  // コンテナのサイズ変化に追従する（画面回転・アドレスバーの伸縮に対応）
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  let animationId = 0;

  function loop(): void {
    animationId = requestAnimationFrame(loop);
    for (const callback of frameCallbacks) callback();
    renderer.render(scene, camera);
  }

  return {
    renderer,
    scene,
    camera,
    canvas: renderer.domElement,
    photoLayer,
    maskLayer,
    setContentAspect(aspect) {
      // 角をドラッグするたびに呼ばれる。変わっていないなら測り直さない
      if (contentAspect === aspect) return;
      contentAspect = aspect;
      resize();
    },
    setPhotoView(view) {
      photoView = view;
      // ピンチの間ずっと呼ばれる。入れ物の大きさは変わらないので測り直さない
      applyPhotoView();
    },
    onFrame(callback) {
      frameCallbacks.push(callback);
    },
    start() {
      loop();
    },
    dispose() {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      photoLayer.remove();
      maskLayer.remove();
    },
  };
}
