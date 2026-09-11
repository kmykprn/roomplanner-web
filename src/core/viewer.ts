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

export interface Viewer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /**
   * 描画範囲を指定の縦横比に収める。null で画面いっぱいに戻す。
   *
   * 写真モードで要る。写真は画面いっぱいには収まらない（縦横比が違う）ので
   * 余白ができるが、3D をその余白にまで描くと、写真の中の床と 3D の床が
   * 対応しなくなる。**写真が写っている矩形の中だけに描く。**
   */
  setContentAspect(aspect: number | null): void;

  /** 毎フレーム呼ばれる処理を登録する */
  onFrame(callback: () => void): void;
  start(): void;
  dispose(): void;
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

  container.appendChild(renderer.domElement);

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

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

  const frameCallbacks: Array<() => void> = [];

  /** 描画範囲の縦横比。null なら入れ物いっぱいに描く */
  let contentAspect: number | null = null;

  function resize(): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    // 指定された縦横比に収める（写真と同じ「はみ出さずに全体を入れる」置き方）
    const drawWidth = contentAspect
      ? Math.min(width, height * contentAspect)
      : width;
    const drawHeight = contentAspect ? drawWidth / contentAspect : height;

    renderer.setSize(drawWidth, drawHeight, false);

    // キャンバスの見た目の大きさと位置。中央に寄せる。
    // CSS の 100% 指定より、ここで入れる値のほうが優先される
    const style = renderer.domElement.style;
    style.width = `${drawWidth}px`;
    style.height = `${drawHeight}px`;
    style.marginLeft = `${(width - drawWidth) / 2}px`;
    style.marginTop = `${(height - drawHeight) / 2}px`;

    camera.aspect = drawWidth / drawHeight;
    camera.updateProjectionMatrix();
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
    setContentAspect(aspect) {
      // 角をドラッグするたびに呼ばれる。変わっていないなら測り直さない
      if (contentAspect === aspect) return;
      contentAspect = aspect;
      resize();
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
    },
  };
}
