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
import { createPhotoZoom } from '@/interaction/photoZoom';
import { createMaskPaint } from '@/interaction/maskPaint';
import { createBottomSheet } from '@/ui/bottomSheet';
import { createModeSwitch } from '@/ui/modeSwitch';
import { appState, roomScene } from '@/core/appState';
import { photoState, photoScene } from '@/core/photoState';
import { isPhotoMode, modeState } from '@/core/mode';
import {
  persistPhotoOnChange,
  persistRoomOnChange,
  restorePhoto,
  restoreRoom,
} from '@/core/persistence';
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
restorePhoto();

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
viewer.scene.add(
  roomObjects.group,
  createLighting(room),
  roomFurniture.group,
  photoFurniture.group
);

// --- 操作を繋ぐ ---
const cameraControls = createCameraControls(viewer.canvas, viewer.camera);
createFurnitureDrag(
  viewer.canvas,
  viewer.camera,
  // 掴んだ時点のモードで対象を決める
  () =>
    isPhotoMode()
      ? { scene: photoScene, layer: photoFurniture, surface: 'screen' }
      : { scene: roomScene, layer: roomFurniture, surface: 'floor' },
  cameraControls,
  // 隠す場所を塗っている間は、1 本指の動きは筆のほうへ渡す
  () => !photoState.get().isMasking
);

// 隠す場所を塗る。「隠す」タブを開いている間だけ効く
createMaskPaint(viewer.canvas);

// 写真に寄る操作。2本指のときだけ動くので、家具のドラッグとは取り合わない。
// 写真がまだ無いうちは効かせない（寄る相手が無いのに3Dだけ拡大されると訳が分からない）
createPhotoZoom(
  viewer.canvas,
  () => isPhotoMode() && photoState.get().backgroundStatus === 'ready'
);
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

  if (photo) {
    applyPhotoView();
  } else {
    // 写真モードは描画範囲も画角も切り取りも変えるので、すべて戻す。
    // 切り取りを残すと、部屋モードの描画まで寄ったままになる
    viewer.setPhotoView(null);
    viewer.setContentAspect(null);
    viewer.camera.fov = roomFov;
    viewer.camera.updateProjectionMatrix();
  }
}

function applyBackground(): void {
  const { backgroundUrl, maskUrl, isMasking } = photoState.get();
  const image = backgroundUrl ? `url("${backgroundUrl}")` : '';
  viewer.photoLayer.style.backgroundImage = image;

  // 隠す層は同じ写真を、塗った形で切り抜いて重ねる
  const { maskLayer } = viewer;
  maskLayer.style.backgroundImage = image;
  applyMaskImage(maskUrl);
  // 塗っている間は塗った場所を色付きで見せる（写真の上に写真を重ねても見分けがつかない）
  maskLayer.classList.toggle('is-editing', isMasking);
}

/** いま隠す層に当てている切り抜き。差し替えたあとに前のものを解放するために覚えておく */
let appliedMaskUrl: string | null = null;
/**
 * 読み込み待ちの切り抜き。読み込み中にまた差し替わったら、古いほうは当てない。
 * undefined は「待っているものが無い」。null は「無し（消す）」を待っている、の意味で区別する
 */
let pendingMaskUrl: string | null | undefined = undefined;

/**
 * 切り抜きの画像を隠す層に当てる。
 *
 * **先に読み込んでから差し替える。** 読み込む前に差し替えると、読み終わるまでの
 * 一瞬だけ切り抜きが空になり、塗っている間ずっとチラつく（毎フレーム差し替えるため）。
 * 読み込み済みの画像なら、差し替えはその場で終わり途切れない
 */
function applyMaskImage(url: string | null): void {
  // いま向かっている先（読み込み待ちがあればそれ、無ければ当てているもの）と同じなら何もしない
  const heading = pendingMaskUrl === undefined ? appliedMaskUrl : pendingMaskUrl;
  if (url === heading) return;
  pendingMaskUrl = url;

  if (!url) {
    swapMaskImage(null);
    return;
  }
  const image = new Image();
  image.onload = () => {
    if (pendingMaskUrl === url) swapMaskImage(url);
  };
  image.onerror = () => {
    if (pendingMaskUrl === url) swapMaskImage(null);
  };
  image.src = url;
}

function swapMaskImage(url: string | null): void {
  const { maskLayer } = viewer;
  const maskImage = url ? `url("${url}")` : 'none';
  maskLayer.style.setProperty('mask-image', maskImage);
  maskLayer.style.setProperty('-webkit-mask-image', maskImage);
  // 切り抜きが無い間は出さない（無いと写真がまるごと家具の上に乗る）
  maskLayer.classList.toggle('has-mask', Boolean(url));

  // 前のものはここで解放する。差し替える前に解放すると、表示中の切り抜きが消える
  if (appliedMaskUrl?.startsWith('blob:')) URL.revokeObjectURL(appliedMaskUrl);
  appliedMaskUrl = url;
  pendingMaskUrl = undefined;
}

/**
 * 写真モードの見え方を、いまの状態に合わせる。
 *
 * **3D を描く範囲を写真の矩形に合わせるのが肝。** 写真は画面いっぱいには
 * 収まらないので余白ができるが、そこにまで 3D を描くと、写真の中の床と
 * 3D の床が対応しなくなり、家具の見え方が写真とずれる。
 */
function applyPhotoView(): void {
  if (!isPhotoMode()) return;
  const { backgroundAspect, view } = photoState.get();

  viewer.setContentAspect(backgroundAspect);
  applyPhotoCamera(viewer.camera);
  viewer.setPhotoView(view);
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
persistPhotoOnChange();
// 前回の生成が終わっていれば、ここで部屋に置かれる
resumeGeneration();

// --- 毎フレームの処理 ---
viewer.onFrame(() => {
  if (isPhotoMode()) return; // 写真モードのカメラは固定なので、追従させるものが無い
  cameraControls.update();
  updateWallVisibility(); // カメラが動いたぶんだけ壁の透過を追従させる
});

viewer.start();
