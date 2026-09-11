/**
 * 床をつかんで動かすギズモ。
 *
 * three.js 同梱の `TransformControls` を、床のグループに取り付ける。
 * 出るものは触っているものによって変わる。
 *
 *   移動 … 矢印3本（左右・上下・奥行き）
 *   回転 … リング3つ（寝かせ具合・向き・水平）
 *   大きさ … 1メートルの見かけの大きさ
 *
 * ギズモとボタン（`ui/alignPanel.ts`）は同じ値を触る。**両方から書き込むので、
 * どちらが書いたのかで処理を分けない**（状態を見て素直に反映するだけにする）。
 */

import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { adjustFloorTransform, photoState } from '@/core/photoState';

/**
 * ギズモの大きさ。既定（1）はマウス向けで、指には細い。
 * 画面の狭いスマホでも掴めるところまで大きくしてある
 */
const GIZMO_SIZE = 1.5;

export interface FloorGizmo {
  /** シーンに足す見た目。ギズモ本体は Object3D ではないので、これを足す */
  helper: THREE.Object3D;
  /** 状態に合わせて、出す・引っ込める・触るものを切り替える */
  sync(): void;
}

export function createFloorGizmo(
  camera: THREE.Camera,
  canvas: HTMLElement,
  floor: THREE.Object3D
): FloorGizmo {
  const controls = new TransformControls(camera, canvas);
  controls.size = GIZMO_SIZE;
  controls.attach(floor);

  // ギズモで動かした結果を状態へ書き戻す。
  // 画面に出す数値（ボタン側の表示）も、保存するときの値もここを見る
  controls.addEventListener('objectChange', () => {
    adjustFloorTransform({
      position: floor.position.toArray() as [number, number, number],
      rotation: [
        THREE.MathUtils.radToDeg(floor.rotation.x),
        THREE.MathUtils.radToDeg(floor.rotation.y),
        THREE.MathUtils.radToDeg(floor.rotation.z),
      ],
      // 拡大は3軸そろえて使う。1メートルの見かけの大きさを変えるためのもので、
      // 軸ごとに変えると床が歪んでしまう
      scale: floor.scale.x,
    });
  });

  const helper = controls.getHelper();

  function sync(): void {
    const { isAligning, gizmoMode } = photoState.get();
    controls.enabled = isAligning;
    helper.visible = isAligning;
    controls.setMode(gizmoMode);
  }

  sync();
  return { helper, sync };
}
