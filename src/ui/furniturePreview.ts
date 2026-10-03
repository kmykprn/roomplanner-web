/**
 * 家具のメニュー（ui/modelPanel.ts の createTileActions）の大きな見本。
 *
 *   3D … 縦の軸でゆっくり回す（1 周 TURN_SECONDS 秒）。指でなぞるとその向きに回り、離すとその向きからまた回り始める
 *   2D … 切り抜きを上下にゆっくり揺らす（style.css の .preview__flat）。下の影も合わせて伸び縮みする
 *
 * 回る 3D と揺れる 2D を見比べれば、「向きを変えられる立体」と「平らな切り抜き」の違いが説明なしで分かる。
 *
 * **3D はメニューを開いている間だけ描く。** 開くたびに小さな描画の枠を作り、閉じたら片付ける。
 * 開きっぱなしの描画の枠は電池を使い、端末によっては同時に持てる数にも限りがあるため。
 * 3D を読み込むまでは 2D の切り抜きを出しておく。動きを減らす設定の端末では、どちらも動かさない
 */

import * as THREE from 'three';

import type { GeneratedModel, ModelFacet } from '@/core/modelLibrary';
import { resolveModelUrl } from '@/platform/modelCache';
import { loadFurnitureModel } from '@/scene/modelLoader';
import { createPreviewImage } from '@/ui/previewImage';

/** 3D が 1 周するのにかける秒数 */
const TURN_SECONDS = 9;
/** 指でなぞった 1px あたりに回す角度（ラジアン） */
const DRAG_RADIANS_PER_PX = 0.012;
/** 回し始めの向き。真正面より少し斜めにして、奥行きのある形だと分かるようにする */
const START_ANGLE = -0.5;
/** 見本を見下ろす角度（ラジアン）。座面や天板が少し見える高さ */
const VIEW_PITCH = 0.18;
/** 縦の画角（度） */
const FOV = 30;
/** 家具のまわりに空ける余白（家具の大きさに対する割合） */
const MARGIN = 1.0;

export interface FurniturePreview {
  element: HTMLElement;
  /** 家具の見本を出す。facet が solid で 3D があれば回る 3D、それ以外は揺れる 2D */
  show(model: GeneratedModel, facet: ModelFacet): void;
  /** 3D の描画を止めて片付ける。メニューを閉じたときに呼ぶ */
  stop(): void;
}

export function createFurniturePreview(): FurniturePreview {
  const element = document.createElement('div');
  element.className = 'preview';

  const flat = document.createElement('div');
  flat.className = 'preview__flat';
  const flatImage = document.createElement('span');
  flatImage.className = 'preview__image';
  const flatShadow = document.createElement('span');
  flatShadow.className = 'preview__shadow';
  flat.append(flatImage, flatShadow);
  const flatPreview = createPreviewImage(flatImage);
  element.append(flat);

  /** いま描いている 3D。片付けるために持つ */
  let solid: { stop(): void } | null = null;
  /** 開くたびに増やす。読み込みを待つ間に開き直されたら、古い読み込みは使わない */
  let showCount = 0;

  function stop(): void {
    showCount += 1;
    solid?.stop();
    solid = null;
    element.classList.remove('is-solid');
  }

  function show(model: GeneratedModel, facet: ModelFacet): void {
    stop();
    const count = showCount;
    // 3D を読み込むまでの間も、切り抜きを出しておく
    flatPreview.show({ cutoutKey: model.imageKey, previewKey: model.previewKey });
    if (facet !== 'solid' || !model.modelKey) return;
    void resolveModelUrl(model.modelKey)
      .then((url) => (url ? loadFurnitureModel(url, [1, 1, 1]) : null))
      .then((loaded) => {
        if (!loaded || count !== showCount) return;
        solid = startTurntable(element, loaded);
        element.classList.add('is-solid');
      })
      .catch(() => {
        // 読めなければ切り抜きのまま
      });
  }

  return { element, show, stop };
}

/** 3D を回して描き始める。返す stop で、描画の枠ごと片付ける */
function startTurntable(host: HTMLElement, model: THREE.Group): { stop(): void } {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  canvas.className = 'preview__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 50);

  // 家具は底面が y = 0（scene/modelLoader.ts）。回す軸は家具の中心を通る縦の線
  const turntable = new THREE.Group();
  turntable.add(model);
  scene.add(turntable);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // どの向きに回っても収まるよう、家具を包む球の大きさで距離を決める
  const radius = size.length() / 2;

  function resize(): void {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // 縦と横のうち狭いほうの画角に、球が余白込みで収まる距離
    const halfFov = THREE.MathUtils.degToRad(FOV / 2);
    const fitHalf = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
    const distance = (radius * MARGIN) / Math.sin(fitHalf);
    camera.position.set(0, center.y + Math.sin(VIEW_PITCH) * distance, Math.cos(VIEW_PITCH) * distance);
    camera.lookAt(0, center.y, 0);
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  let angle = START_ANGLE;
  let dragging = false;
  let lastX = 0;
  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    angle += (event.clientX - lastX) * DRAG_RADIANS_PER_PX;
    lastX = event.clientX;
  });
  const endDrag = (): void => {
    dragging = false;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  let previous = performance.now();
  let frame = requestAnimationFrame(function draw(now) {
    const seconds = Math.min(0.1, (now - previous) / 1000);
    previous = now;
    if (!dragging && !reduceMotion) angle += (seconds / TURN_SECONDS) * Math.PI * 2;
    turntable.rotation.y = angle;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(draw);
  });

  return {
    stop() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      // 中身（形・材質）は読み込みの使い回しなので捨てない（scene/modelLoader.ts）。描画の枠だけ手放す
      turntable.remove(model);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
