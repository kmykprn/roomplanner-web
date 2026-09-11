/**
 * エントリポイント。ここを読めばアプリ全体の組み立てが分かるようにしてある。
 *
 * React がないので、起動処理は上から下へ 1 度だけ走る手続きになる。
 * 「いつ再レンダリングされるか」を考える必要がない。
 *
 * モードは2つある。**3D の世界は1つのまま**、表示するものとカメラを差し替える。
 *
 *   部屋 … 部屋を組み立てて、その中に家具を置く
 *   写真 … 選んだ写真を背景にして、その上に家具を置く
 */

import '@/style.css';
import * as THREE from 'three';
import { createViewer } from '@/core/viewer';
import { createRoom } from '@/scene/room';
import { createLighting } from '@/scene/lighting';
import { createFurnitureLayer } from '@/scene/furniture';
import { createCameraControls } from '@/interaction/cameraControls';
import { createWallVisibility } from '@/interaction/wallVisibility';
import { createFurnitureDrag } from '@/interaction/furnitureDrag';
import { applyPhotoCamera } from '@/interaction/photoCamera';
import { createFloorGrid } from '@/scene/floorGrid';
import { createFloorGizmo } from '@/interaction/floorGizmo';
import { createBottomSheet } from '@/ui/bottomSheet';
import { createModeSwitch } from '@/ui/modeSwitch';
import { appState, roomScene } from '@/core/appState';
import { photoState, photoScene } from '@/core/photoState';
import { isPhotoMode, modeState } from '@/core/mode';
import { persistRoomOnChange, restoreRoom } from '@/core/persistence';
import { resumeGeneration } from '@/core/generation';
import { THEME } from '@/config/theme';

/** 起動に必須の要素を取る。無ければどれが無いのか分かる形で止める */
function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`起動に必要な要素が見つかりません: ${selector}`);
  return element;
}

const viewport = requireElement('#viewport');
const app = requireElement('#app');
const header = requireElement('.header');

// シーンを組み立てる前に読み戻す。あとからだと部屋の大きさが二重に反映される
restoreRoom();

const viewer = createViewer(viewport);
const { room } = appState.get();

// 写真モードはカメラの画角を写真に合わせて変える。
// 戻すときのために、部屋モードの画角をここで控えておく
const roomFov = viewer.camera.fov;

// --- シーンを組み立てる ---
const roomObjects = createRoom(room);
// 家具のレイヤーはモードごとに持つ。状態を分けてあるので 3D 側も分ける
const roomFurniture = createFurnitureLayer();
const photoFurniture = createFurnitureLayer();
/**
 * 写真モードの床。
 *
 * **方眼と、その上に置いた家具をまとめてここに入れる。** これを動かすことが
 * そのまま「写真に床を合わせる」になる（カメラは動かさない）。
 * 家具の座標はこの中から見たものなので、「床は y = 0、家具は底面基準」の
 * 決まりはそのまま使える。
 */
const photoFloor = new THREE.Group();
const floorGrid = createFloorGrid();
photoFloor.add(floorGrid.object, photoFurniture.group);

viewer.scene.add(roomObjects.group, createLighting(room), roomFurniture.group, photoFloor);

// --- 操作を繋ぐ ---
const cameraControls = createCameraControls(viewer.canvas, viewer.camera);
createFurnitureDrag(
  viewer.canvas,
  viewer.camera,
  // 掴んだ時点のモードで対象を決める
  () =>
    isPhotoMode()
      ? { scene: photoScene, layer: photoFurniture, frame: photoFloor }
      : { scene: roomScene, layer: roomFurniture },
  cameraControls,
  // 床を合わせている間は、指の動きはギズモのほうへ渡す
  () => !photoState.get().isAligning
);

// 床をつかんで動かすギズモ。「床」タブを開いている間だけ出る
const floorGizmo = createFloorGizmo(viewer.camera, viewer.canvas, photoFloor);
viewer.scene.add(floorGizmo.helper);
const updateWallVisibility = createWallVisibility(roomObjects.walls, viewer.camera, room);

// --- 状態とシーンを同期する ---
// 状態が変わったときだけ呼ばれる。毎フレーム差分を取る必要はない
appState.subscribe((state) => roomFurniture.sync(state.furniture, state.selectedId));
photoState.subscribe((state) => photoFurniture.sync(state.furniture, state.selectedId));

// subscribe は登録するだけで、その場では呼ばれない。
// 保存した部屋を読み戻したときは変化が起きないので、ここで一度だけ描く。
// これが無いと、復元した家具が状態にはあるのに画面に出ない
roomFurniture.sync(appState.get().furniture, appState.get().selectedId);

// --- モードの切り替え ---
/** 部屋モードの背景色。写真モードでは透明にして、CSS で敷いた写真を透かす */
const roomBackground = new THREE.Color(THEME.background);

function applyMode(): void {
  const photo = isPhotoMode();

  roomObjects.group.visible = !photo;
  roomFurniture.group.visible = !photo;
  photoFurniture.group.visible = photo;

  // 写真モードは背景を塗らない。塗ると CSS の写真が隠れる
  viewer.scene.background = photo ? null : roomBackground;
  viewport.classList.toggle('viewport--photo', photo);

  // 写真モードのカメラは固定。写真は動かないので、カメラだけ回ると嘘になる
  cameraControls.enabled = !photo;
  floorGrid.object.visible = false;
  floorGizmo.helper.visible = false;
  photoFloor.visible = photo;

  if (photo) {
    applyPhotoView();
  } else {
    // 写真モードは描画範囲も画角も変えるので、どちらも戻す
    viewer.setContentAspect(null);
    viewer.camera.fov = roomFov;
    viewer.camera.updateProjectionMatrix();
  }
}

function applyBackground(): void {
  const { backgroundUrl } = photoState.get();
  viewport.style.backgroundImage = backgroundUrl ? `url("${backgroundUrl}")` : '';
}

/**
 * 写真モードの見え方を、いまの状態に合わせる。
 *
 * **3D を描く範囲を写真の矩形に合わせるのが肝。** 写真は画面いっぱいには
 * 収まらないので余白ができるが、そこにまで 3D を描くと、写真の中の床と
 * 3D の床が対応しなくなり、方眼を合わせても意味がなくなる。
 */
function applyPhotoView(): void {
  if (!isPhotoMode()) return;
  const { backgroundAspect, floorTransform, isAligning, backgroundStatus } = photoState.get();

  viewer.setContentAspect(backgroundAspect);
  applyPhotoCamera(viewer.camera);

  // 状態を床のグループへ反映する。ギズモで動かしたときも、ボタンで動かしたときも、
  // 通り道はここ1本にしておく
  photoFloor.position.set(...floorTransform.position);
  photoFloor.rotation.set(
    THREE.MathUtils.degToRad(floorTransform.rotation[0]),
    THREE.MathUtils.degToRad(floorTransform.rotation[1]),
    THREE.MathUtils.degToRad(floorTransform.rotation[2])
  );
  photoFloor.scale.setScalar(floorTransform.scale);

  floorGrid.object.visible = isAligning && backgroundStatus === 'ready';
  floorGizmo.sync();
}

modeState.subscribe(applyMode);
photoState.subscribe(applyBackground);
photoState.subscribe(applyPhotoView);
applyMode();
applyBackground();

// --- UI ---
header.appendChild(createModeSwitch());
createBottomSheet(app);

// --- 端末に残す ---
persistRoomOnChange();
// 前回の生成が終わっていれば、ここで部屋に置かれる
resumeGeneration();

// --- 毎フレームの処理 ---
viewer.onFrame(() => {
  if (isPhotoMode()) return; // 写真モードのカメラは固定なので、追従させるものが無い
  cameraControls.update();
  updateWallVisibility(); // カメラが動いたぶんだけ壁の透過を追従させる
});

viewer.start();
