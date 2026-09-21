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
import { buildInteriorTextures } from '@/scene/interiorTextures';
import type { RoomSize } from '@/config/room';
import type { Interior } from '@/core/appState';
import { createLighting } from '@/scene/lighting';
import { createPhotoShadow } from '@/scene/photoShadow';
import { createFurnitureLayer } from '@/scene/furniture';
import { createCameraControls } from '@/interaction/cameraControls';
import { createWallVisibility } from '@/interaction/wallVisibility';
import { createFurnitureDrag } from '@/interaction/furnitureDrag';
import { applyPhotoCamera } from '@/interaction/photoCamera';
import { createPhotoZoom } from '@/interaction/photoZoom';
import { createFloorFitDrag } from '@/interaction/floorFitDrag';
import { createMeasureTap } from '@/interaction/measureTap';
import { createMeasureOverlay } from '@/ui/measureOverlay';
import { perMetreAt, solveFloorScale } from '@/core/photoMeasure';
import { viewOrigin } from '@/core/photoView';
import type { PlacedFurniture } from '@/config/furniture';
import { createFloorMarkers } from '@/scene/floorMarkers';
import { createMaskPaint } from '@/interaction/maskPaint';
import { createBottomSheet } from '@/ui/bottomSheet';
import { createModeSwitch } from '@/ui/modeSwitch';
import { createPhotoEmpty } from '@/ui/photoEmpty';
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
import { resumeCutouts } from '@/core/cutout';
import { watchWallet } from '@/core/wallet';
import { restoreModelLibrary } from '@/core/modelLibrary';
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
// 作ったモデルの保管庫。置いてある家具を見て取り込むので、部屋と写真のあと
restoreModelLibrary();

const viewer = createViewer(viewport);
// 写真が無いときの案内。キャンバスと写真の層の上に重ねるので、viewer のあとに足す
viewport.append(createPhotoEmpty());
// 床を合わせている間の目安のバー。キャンバスの上に重ねる
const { room } = appState.get();

// --- シーンを組み立てる ---
const roomObjects = createRoom(room);
// 家具のレイヤーはモードごとに持つ。状態を分けてあるので 3D 側も分ける
const roomFurniture = createFurnitureLayer();
const photoFurniture = createFurnitureLayer();
// 床を合わせるときの見本の椅子。合わせている間だけ出す
const floorMarkers = createFloorMarkers();
// 写真の上に落ちる影。写真モードのときだけ出す
const photoShadow = createPhotoShadow();
const lighting = createLighting(room);
viewer.scene.add(
  roomObjects.group,
  lighting.group,
  roomFurniture.group,
  photoFurniture.group,
  floorMarkers.group,
  photoShadow.group
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
  // 隠す場所を塗っている間・床を合わせている間・大きさの基準を測っている間は、
  // 1 本指の動きをそちらへ渡す
  () => {
    const { isMasking, isFittingFloor, isMeasuring } = photoState.get();
    return !isMasking && !isFittingFloor && !isMeasuring;
  }
);

// 大きさの基準を測る。測っている姿のときだけ、タップが「端を押す」になる
createMeasureTap(viewer.canvas, () => isPhotoMode() && photoState.get().isMeasuring);
// 押した点と測った線を写真の上に描く
createMeasureOverlay(viewer.overlayLayer);

// 床を合わせる。合わせている姿のときだけ効く。椅子の上なら椅子が動き、外なら傾きが変わる
createFloorFitDrag(viewer.canvas, {
  isActive: () => isPhotoMode() && photoState.get().isFittingFloor,
  hitsMarker: (point) => floorMarkers.hitsMarker(viewer.camera, point),
});

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

// 内装（壁と床の柄）と部屋の大きさ。変わったときだけ描き直す（柄を描くのは数十 ms かかる）
let appliedInterior: string | null = null;
function applyInterior(state: { room: RoomSize; interior: Interior }): void {
  const key = JSON.stringify([state.room, state.interior]);
  if (key === appliedInterior) return;
  appliedInterior = key;
  roomObjects.resize(state.room);
  roomObjects.applyInterior(buildInteriorTextures(state.interior.template, state.room, state.interior.mats));
}
applyInterior(appState.get());
appState.subscribe(applyInterior);
// 写真モードの家具は applyPhotoView の中で映す。見た目の大きさがカメラの向きに
// 依存するので、カメラを置き直したあとでないと正しい倍率が出ない

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
  // 影を受ける面は写真モードだけ。部屋モードには本物の床があり、そちらが影を受ける。
  // 部屋の主光源は写真モードでは影を落とさない（向きの違う影が 2 つ重なるため）
  photoShadow.group.visible = photo;
  lighting.setCastShadow(!photo);
  applyFloorFitting();

  // 写真モードは背景を塗らない。塗ると CSS の写真が隠れる
  viewer.scene.background = photo ? null : roomBackground;
  viewport.classList.toggle('viewport--photo', photo);

  // 写真モードのカメラは固定。写真は動かないので、カメラだけ回ると嘘になる
  cameraControls.enabled = !photo;

  if (photo) {
    applyPhotoView();
  } else {
    // 写真モードは描画範囲も切り取りも変えるので、両方戻す。
    // 切り取りを残すと、部屋モードの描画まで寄ったままになる。
    // 画角は描画領域の高さから viewer が決め直すので、ここでは触らない
    viewer.setPhotoView(null);
    viewer.setContentAspect(null);
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
  const { backgroundAspect, view, floorFit, furniture, selectedId } = photoState.get();

  viewer.setContentAspect(backgroundAspect);
  applyPhotoCamera(viewer.camera, floorFit);
  viewer.setPhotoView(view);
  photoFurniture.sync(furniture, selectedId, photoDisplayScale);
  // 見本の椅子は画面の指した場所に置く。カメラを動かしたあとに置き直す
  floorMarkers.update(viewer.camera, photoState.get().floorProbe);
}

/**
 * 写真の中でこの家具が写るべき大きさを、実寸に対する倍率で返す。
 *
 * 測った長さから「足元の高さでの 1m の大きさ」が分かる（core/photoMeasure.ts）。
 * いまの描き方での 1m の大きさと比べて、その比を家具に掛ける。
 * 家具の実寸（m）はそのままなので、測定を外せば元に戻る
 */
const footPoint = new THREE.Vector3();
const headPoint = new THREE.Vector3();
function photoDisplayScale(item: PlacedFurniture): number {
  const { measures, backgroundAspect, view } = photoState.get();
  if (!backgroundAspect || measures.length === 0) return 1;
  const floorScale = solveFloorScale(measures, backgroundAspect);
  if (!floorScale) return 1;

  const camera = viewer.camera;
  camera.updateMatrixWorld(true);
  // 足元と、その 1m 真上を画面に映す。画面の座標は見えている矩形の中の割合なので、
  // 寄っている分を戻して写真の中の割合にする
  footPoint.set(...item.position).project(camera);
  headPoint.set(item.position[0], item.position[1] + 1, item.position[2]).project(camera);
  const footY = viewOrigin(view).y + (1 - footPoint.y) / 2 / view.scale;
  // 画面の座標は上が正。1m 上の点のほうが大きい値になる
  const ownPerMetre = (headPoint.y - footPoint.y) / 2 / view.scale;
  if (!(ownPerMetre > 0)) return 1;

  const wanted = perMetreAt(floorScale, footY) / ownPerMetre;
  // 地平線のすぐ近くや測り間違いで極端な値が出ても、家具を見失わないように止める
  return Math.min(20, Math.max(0.05, wanted));
}

modeState.subscribe(applyMode);
photoState.subscribe(applyBackground);
photoState.subscribe(applyPhotoView);
/**
 * 床を合わせている間の見せ方。モードと、合わせているかどうかの両方で変わる。
 *
 * **合わせている間は家具を隠す。** 傾きを変えるとカメラが回るので、置いてある家具が
 * 画面の中を大きく動く。見本の椅子と床を見比べたいときに、それが目の邪魔になる
 */
function applyFloorFitting(): void {
  const { isFittingFloor, isDraggingFloor } = photoState.get();
  const fitting = isPhotoMode() && isFittingFloor;

  floorMarkers.group.visible = fitting;
  photoFurniture.group.visible = isPhotoMode() && !fitting;
  // 影を受ける面は、床を合わせている間は床のもの、ふだんは家具ごとのもの
  photoShadow.setGrounds(fitting, photoState.get().furniture.map((item) => item.position));
  // 触れている間は色を変え、床の面を出す（効いていることを返すため）
  floorMarkers.setActive(isDraggingFloor);
}
photoState.subscribe(applyFloorFitting);
applyMode();
applyBackground();

// --- UI ---
header.appendChild(createModeSwitch());
createBottomSheet(app);

// --- 端末に残す ---
persistRoomOnChange();
persistPhotoOnChange();
// 前回の生成・切り抜きが終わっていれば、ここで保管庫に入る
resumeGeneration();
resumeCutouts();
watchWallet();

// --- 毎フレームの処理 ---
viewer.onFrame(() => {
  // 切り抜きの板はカメラのほうを向く。写真モードはカメラが固定なので向きは変わらないが、
  // 置いた直後や向きを変えた直後に正面を向かせるのはここ
  (isPhotoMode() ? photoFurniture : roomFurniture).faceCamera(viewer.camera);
  if (isPhotoMode()) return; // 写真モードのカメラは固定なので、追従させるものが無い
  cameraControls.update();
  updateWallVisibility(); // カメラが動いたぶんだけ壁の透過を追従させる
});

viewer.start();
