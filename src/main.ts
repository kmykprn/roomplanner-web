/**
 * エントリポイント。ここを読めばアプリ全体の組み立てが分かるようにしてある。
 *
 * React がないので、起動処理は上から下へ 1 度だけ走る手続きになる。
 * 「いつ再レンダリングされるか」を考える必要がない。
 */

import '@/style.css';
import { createViewer } from '@/core/viewer';
import { createRoom } from '@/scene/room';
import { createLighting } from '@/scene/lighting';
import { createFurnitureLayer } from '@/scene/furniture';
import { createCameraControls } from '@/interaction/cameraControls';
import { createWallVisibility } from '@/interaction/wallVisibility';
import { createFurnitureDrag } from '@/interaction/furnitureDrag';
import { createBottomSheet } from '@/ui/bottomSheet';
import { appState } from '@/core/appState';
import { persistRoomOnChange, restoreRoom } from '@/core/persistence';
import { resumeGeneration } from '@/core/generation';

const viewport = document.querySelector<HTMLElement>('#viewport');
const app = document.querySelector<HTMLElement>('#app');
if (!viewport || !app) throw new Error('起動に必要な要素が見つかりません');

// シーンを組み立てる前に読み戻す。あとからだと部屋の大きさが二重に反映される
restoreRoom();

const viewer = createViewer(viewport);
const { room } = appState.get();

// --- シーンを組み立てる ---
const roomObjects = createRoom(room);
const furnitureLayer = createFurnitureLayer();
viewer.scene.add(roomObjects.group, createLighting(room), furnitureLayer.group);

// --- 操作を繋ぐ ---
const cameraControls = createCameraControls(viewer.canvas, viewer.camera);
createFurnitureDrag(viewer.canvas, viewer.camera, furnitureLayer, cameraControls);
const updateWallVisibility = createWallVisibility(roomObjects.walls, viewer.camera, room);

// --- 状態とシーンを同期する ---
// 状態が変わったときだけ呼ばれる。毎フレーム差分を取る必要はない
appState.subscribe((state) => furnitureLayer.sync(state.furniture, state.selectedId));

// subscribe は登録するだけで、その場では呼ばれない。
// 保存した部屋を読み戻したときは変化が起きないので、ここで一度だけ描く。
// これが無いと、復元した家具が状態にはあるのに画面に出ない
furnitureLayer.sync(appState.get().furniture, appState.get().selectedId);

// --- UI ---
createBottomSheet(app);

// --- 端末に残す ---
persistRoomOnChange();
// 前回の生成が終わっていれば、ここで部屋に置かれる
resumeGeneration();

// --- 毎フレームの処理 ---
viewer.onFrame(() => {
  cameraControls.update();
  updateWallVisibility(); // カメラが動いたぶんだけ壁の透過を追従させる
});

viewer.start();
