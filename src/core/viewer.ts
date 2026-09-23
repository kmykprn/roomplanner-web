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
import {
  clampPhotoView,
  DEFAULT_PHOTO_VIEW,
  setPhotoFrame,
  viewOrigin,
  visibleSize,
  type PhotoView,
} from '@/core/photoView';

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
   * 写真の上に線や点を描く層。**いちばん上**に重ねる。床に合わせる四隅とマス目を描く。
   * 3D ではなく写真の座標で描くものなので、キャンバスに描かず別の層にしている。
   * 指の操作はキャンバスに通す（pointer-events: none）
   */
  overlayLayer: HTMLCanvasElement;
  /**
   * 写真の縦横比を教える。null で写真なし（部屋モード）。
   *
   * 描くのはいつも画面いっぱい。写真は画面を覆うように敷き、縦横比が違ってはみ出た分は
   * 切り落とす（引き伸ばさない）。3D も同じ範囲を切り取るので、写真の中の床と 3D の床は
   * ずれない。どれだけはみ出たかは core/photoView.ts の setPhotoFrame に入れる
   */
  setContentAspect(aspect: number | null): void;

  /**
   * 写真のどこを、どれだけ寄って見るかを決める。null で全体に戻す。
   *
   * 写真は背景を引き伸ばし、3D は視錐台を切り取って、**同じ矩形**を出す。
   * 3D をキャンバスごと引き伸ばさないので、寄っても家具はボケない
   */
  setPhotoView(view: PhotoView | null): void;

  /**
   * 写真モードの縦の画角（度）を決める。null なら既定（BASE_FOV から描画領域に合わせて出す）。
   *
   * 写真を解析して出た画角を入れる。**画角が写真と違うと、床の上の線の集まり方が
   * 写真とずれ、手前で合わせると奥がずれる。** 傾きをどう動かしても直らない種類のずれ
   */
  setPhotoFov(vfovDeg: number | null): void;

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
 * **描く高さに比例する。** 写真の画角が分からないとき（解析前）は、写真の全体が
 * 画面に占める高さに合わせて画角を決め、部屋モードと同じ大きさで描く。
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
  const overlayLayer = document.createElement('canvas');
  overlayLayer.className = 'viewport__overlay';
  container.append(photoLayer, renderer.domElement, maskLayer, overlayLayer);

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
  /** 写真から出した縦の画角。null なら既定 */
  let photoFov: number | null = null;

  function resize(): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    // いつも入れ物いっぱいに描く。写真は画面を覆うように敷き、はみ出た分は切り落とす
    drawWidth = width;
    drawHeight = height;
    // 倍率 1 のとき、写真の幅と高さのどれだけが画面に入るか。
    // 画面のほうが横長なら写真の上下が、縦長なら左右がはみ出る
    const screenAspect = width / height;
    const frameX = contentAspect && screenAspect < contentAspect ? screenAspect / contentAspect : 1;
    const frameY = contentAspect && screenAspect > contentAspect ? contentAspect / screenAspect : 1;
    setPhotoFrame(frameX, frameY);

    renderer.setSize(drawWidth, drawHeight, false);

    // キャンバスと写真の層を、同じ大きさ・同じ場所に重ねる。
    // 入れ物の中央に寄せる（CSS の 100% 指定より、ここで入れる値が優先される）
    for (const element of [renderer.domElement, photoLayer, maskLayer, overlayLayer]) {
      const style = element.style;
      style.position = 'absolute';
      style.left = `${(width - drawWidth) / 2}px`;
      style.top = `${(height - drawHeight) / 2}px`;
      style.width = `${drawWidth}px`;
      style.height = `${drawHeight}px`;
    }

    // 線の層は CSS の大きさとは別に、描く画素数も端末に合わせる（合わせないと線がぼやける）
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    overlayLayer.width = Math.round(drawWidth * pixelRatio);
    overlayLayer.height = Math.round(drawHeight * pixelRatio);

    // カメラは写真の全体に合わせる（縦横比も画角も写真のもの）。見える範囲は applyPhotoView で切り取る
    camera.aspect = contentAspect ?? drawWidth / drawHeight;
    camera.fov = photoFov ?? fovForDrawHeight(drawHeight / frameY, height);
    applyPhotoView();
  }

  /**
   * 見ている矩形を、写真と 3D の両方へ反映する。
   *
   * 写真は引き伸ばした背景をずらし、3D はカメラに同じ割合の切り取りを教える。
   * **どちらも同じ値から出す。**別々に持つと、寄ったときだけ家具が写真からずれる
   */
  function applyPhotoView(): void {
    // 写真があれば、寄っていなくても切り取る（画面を覆うためにはみ出た分を落とす）
    const view = photoView ?? (contentAspect ? DEFAULT_PHOTO_VIEW : null);
    if (!view) {
      camera.clearViewOffset(); // updateProjectionMatrix も中で呼ばれる
      setImageFit(photoLayer, '', '');
      setImageFit(maskLayer, '', '');
      return;
    }

    // 画面の大きさが変わると見える幅も変わるので、ここでも写真の中に収め直す
    const clamped = clampPhotoView(view);
    const { x, y } = viewOrigin(clamped);
    const { width, height } = visibleSize(clamped);

    // 全体を 1 × 1 として渡す。割合で持つので、画面の大きさが変わっても効き方は同じ
    camera.setViewOffset(1, 1, x, y, width, height);

    // 写真は「見える割合」の逆数だけ拡大して敷き、左上を合わせる。縦横とも px で指定する
    const size = `${drawWidth / width}px ${drawHeight / height}px`;
    const position = `${(-x * drawWidth) / width}px ${(-y * drawHeight) / height}px`;
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
    overlayLayer,
    setContentAspect(aspect) {
      // 角をドラッグするたびに呼ばれる。変わっていないなら測り直さない
      if (contentAspect === aspect) return;
      contentAspect = aspect;
      resize();
    },
    setPhotoFov(vfovDeg) {
      if (photoFov === vfovDeg) return;
      photoFov = vfovDeg;
      resize(); // 画角はサイズと一緒に決めているので、そこをやり直す
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
      overlayLayer.remove();
    },
  };
}
