/**
 * タッチ／マウスでカメラを操作する。
 * v4 の GestureToCameraTransform.tsx（react-native-gesture-handler + reanimated）の置き換え。
 *
 *   1 本指ドラッグ … 部屋のまわりを回る（回転）
 *   2 本指ピンチ  … 寄る / 引く（ズーム）
 *   2 本指ドラッグ … 注視点を平行移動（パン）
 *
 * カメラは常に target を中心とした球面上に置く。
 * 球面座標（半径・水平角・仰角）を持つだけなので、位置は毎フレーム導出できる。
 */

import * as THREE from 'three';

/** 仰角の可動域。真上・真横まで行くと操作不能になるので制限する */
const MIN_POLAR_DEG = 10;
const MAX_POLAR_DEG = 80;

/** ズームの可動域（メートル） */
const MIN_DISTANCE = 2;
const MAX_DISTANCE = 40;

const ROTATE_SENSITIVITY = 0.005; // ラジアン / ピクセル
const PAN_SENSITIVITY = 0.004; // メートル / ピクセル

export interface CameraControls {
  /** 家具のドラッグ中など、カメラを動かしたくないときに false にする */
  enabled: boolean;
  update(): void;
  dispose(): void;
}

export function createCameraControls(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera
): CameraControls {
  const spherical = new THREE.Spherical(
    9, // 半径
    THREE.MathUtils.degToRad(60), // 仰角（真上からの角度）
    THREE.MathUtils.degToRad(45) // 水平角
  );
  const target = new THREE.Vector3(0, 1, 0); // 注視点。床より少し上を見る

  // 画面に触れている指を id で管理する。2 本指ジェスチャの判定に使う
  const pointers = new Map<number, { x: number; y: number }>();
  let previousPinchDistance = 0;

  const controls: CameraControls = { enabled: true, update, dispose };

  function onPointerDown(event: PointerEvent): void {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    previousPinchDistance = 0; // 指の本数が変わったらピンチ基準をリセット
  }

  function onPointerMove(event: PointerEvent): void {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;

    const deltaX = event.clientX - previous.x;
    const deltaY = event.clientY - previous.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (!controls.enabled) return;

    if (pointers.size === 1) {
      rotate(deltaX, deltaY);
    } else if (pointers.size === 2) {
      pinch();
      // 2 本指の平均移動量を平行移動として扱う（各指が deltaX/2 ずつ寄与する）
      pan(deltaX / 2, deltaY / 2);
    }
  }

  function onPointerUp(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    previousPinchDistance = 0;
  }

  function rotate(deltaX: number, deltaY: number): void {
    spherical.theta -= deltaX * ROTATE_SENSITIVITY;
    spherical.phi -= deltaY * ROTATE_SENSITIVITY;
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi,
      THREE.MathUtils.degToRad(MIN_POLAR_DEG),
      THREE.MathUtils.degToRad(MAX_POLAR_DEG)
    );
  }

  function pinch(): void {
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);

    // 1 フレーム目は前回値がないので基準を取るだけ
    if (previousPinchDistance > 0) {
      const ratio = distance / previousPinchDistance;
      spherical.radius = THREE.MathUtils.clamp(
        spherical.radius / ratio,
        MIN_DISTANCE,
        MAX_DISTANCE
      );
    }
    previousPinchDistance = distance;
  }

  /**
   * 注視点を画面に沿って動かす。
   * カメラの姿勢行列から「画面の右方向」「画面の上方向」を取り出して合成する。
   */
  function pan(deltaX: number, deltaY: number): void {
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);

    // 指の動きに画面がついてくるよう、移動量は指と逆向きにする
    // 距離が遠いほど 1 ピクセルあたりの移動量を大きくすると操作感が一定になる
    const scale = PAN_SENSITIVITY * spherical.radius;
    target.addScaledVector(right, -deltaX * scale);
    target.addScaledVector(up, deltaY * scale);
  }

  function update(): void {
    camera.position.setFromSpherical(spherical).add(target);
    camera.lookAt(target);
  }

  function dispose(): void {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  update();
  return controls;
}
