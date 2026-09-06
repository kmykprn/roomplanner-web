/**
 * three.js のレンダラー・シーン・カメラ・描画ループをまとめて作る。
 *
 * React Three Fiber と違い、ここで作ったオブジェクトは
 * 「その場で直接いじれる普通のオブジェクト」になる。
 * 状態を store に入れて再レンダリングを待つ必要がない。
 */

import * as THREE from 'three';
import { THEME } from '@/config/theme';

export interface Viewer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** 毎フレーム呼ばれる処理を登録する */
  onFrame(callback: () => void): void;
  start(): void;
  dispose(): void;
}

export function createViewer(container: HTMLElement): Viewer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // モバイルで 3x は重いので上限を 2 に
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(THEME.background);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

  const frameCallbacks: Array<() => void> = [];

  function resize(): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
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
    onFrame(callback) {
      frameCallbacks.push(callback);
    },
    start() {
      loop();
    },
    dispose() {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
