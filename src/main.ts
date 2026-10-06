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
import { createPhotoShadow, groundsOf } from '@/scene/photoShadow';
import { createDepthOccluder, type FrontBox } from '@/scene/depthOccluder';
import { isBillboard } from '@/config/furniture';
import { createFurnitureLayer } from '@/scene/furniture';
import { learnShape } from '@/core/furnitureHeight';
import { createCameraControls } from '@/interaction/cameraControls';
import { createWallVisibility } from '@/interaction/wallVisibility';
import { createFurnitureDrag } from '@/interaction/furnitureDrag';
import { applyPhotoCamera, floorPointOnScreen } from '@/interaction/photoCamera';
import { createPhotoZoom } from '@/interaction/photoZoom';
import { createScaleLineDrag } from '@/interaction/scaleLineDrag';
import { createPhotoPan } from '@/interaction/photoPan';
import { createLiftHandle } from '@/interaction/liftHandle';
import { drawScaleLines } from '@/ui/scaleLineOverlay';
import { photoPointAt, type PhotoPoint } from '@/core/photoView';
import { createMaskPaint } from '@/interaction/maskPaint';
import { createBottomSheet } from '@/ui/bottomSheet';
import { createModeSwitch } from '@/ui/modeSwitch';
import { createPhotoEmpty } from '@/ui/photoEmpty';
import { createPhotoMenu } from '@/ui/photoMenu';
import { appState, roomScene } from '@/core/appState';
import {
  depthPointAt,
  photoCameraHeight,
  occluderSource,
  photoState,
  photoScene,
  setLensSource,
  setPhotoPlacement,
} from '@/core/photoState';
import { isPhotoMode, modeState } from '@/core/mode';
import {
  connectSceneLibrary,
  loadPhoto,
  loadRoom,
  persistPhotoOnChange,
  persistRoomOnChange,
} from '@/core/persistence';
import { restoreSceneLibrary, sceneLibrary, setSnapshotSource } from '@/core/sceneLibrary';
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

// 保存した背景と部屋の一覧を先に読み、開いているものの中身を読み戻す。
// シーンを組み立てる前に読み戻す。あとからだと部屋の大きさが二重に反映される
restoreSceneLibrary();
connectSceneLibrary();
loadRoom(sceneLibrary.get().current.room);
loadPhoto(sceneLibrary.get().current.photo);
// 作ったモデルの保管庫。置いてある家具を見て取り込むので、部屋と写真のあと
restoreModelLibrary();

const viewer = createViewer(viewport);
// 写真が無いときの案内。キャンバスと写真の層の上に重ねるので、viewer のあとに足す
viewport.append(createPhotoEmpty());
// 写真の右上の［⋯］。押すと背景の操作のメニューが下から出る
viewport.append(createPhotoMenu());
// 床を合わせている間の目安のバー。キャンバスの上に重ねる
const { room } = appState.get();

// --- シーンを組み立てる ---
const roomObjects = createRoom(room);
// 家具のレイヤーはモードごとに持つ。状態を分けてあるので 3D 側も分ける
// 中身が読めたら、箱を中身の形に締める（実際の高さが決まっていればそれに合わせる）
const roomFurniture = createFurnitureLayer({ onMeasured: (id, bounds) => learnShape(roomScene, id, bounds) });
const photoFurniture = createFurnitureLayer({ onMeasured: (id, bounds) => learnShape(photoScene, id, bounds) });
// 写真の上に落ちる影。写真モードのときだけ出す
const photoShadow = createPhotoShadow();
// 写真の中で家具より手前にある物の、見えない面。写真モードのときだけ出す
const depthOccluder = createDepthOccluder();
const lighting = createLighting(room);
viewer.scene.add(
  roomObjects.group,
  lighting.group,
  roomFurniture.group,
  photoFurniture.group,
  photoShadow.group,
  depthOccluder.group,
  depthOccluder.frontGroup
);

// --- 操作を繋ぐ ---
const cameraControls = createCameraControls(viewer.canvas, viewer.camera);
const furnitureDrag = createFurnitureDrag(
  viewer.canvas,
  viewer.camera,
  // 掴んだ時点のモードで対象を決める
  () =>
    isPhotoMode()
      ? // 写真モードでは、寸法を計算する前も後も、足元の高さの水平な面を滑らせる。高さを変えるのは ↕ の取っ手だけ
        { scene: photoScene, layer: photoFurniture, surface: 'level' }
      : { scene: roomScene, layer: roomFurniture, surface: 'floor' },
  cameraControls,
  // 隠す場所を塗っている間と床を合わせている間は、1 本指の動きをそちらへ渡す
  () => !photoState.get().isMasking && !photoState.get().isScaling && !photoState.get().isFramingPhoto
);

// 選んだ家具の真上のつまみ（上下の三角）。ドラッグすると家具がその場で上下に動く。家具そのものを動かしている間は隠す
createLiftHandle({
  container: viewer.canvas.parentElement as HTMLElement,
  canvas: viewer.canvas,
  camera: viewer.camera,
  scene: () => (isPhotoMode() ? photoScene : roomScene),
  isEnabled: () =>
    !furnitureDrag.isMoving() &&
    !photoState.get().isMasking &&
    !photoState.get().isScaling &&
    !photoState.get().isFramingPhoto,
  // 部屋は床より下へは行かない。写真には床の面が無い（奥行きで置いた家具の足元は 0 とは限らない）
  lowest: () => (isPhotoMode() ? -Infinity : 0),
  onFrame: (callback) => viewer.onFrame(callback),
});

// 大きさを合わせる。合わせている姿のときだけ効く。線の両端を動かす
createScaleLineDrag(viewer.canvas, () => isPhotoMode() && photoState.get().isScaling);
// 表示する範囲を調整している間は、1 本指で写真をずらす
createPhotoPan(viewer.canvas, () => isPhotoMode() && photoState.get().isFramingPhoto);

// 隠す場所を塗る。「隠す」タブを開いている間だけ効く
createMaskPaint(viewer.canvas);

// 写真に寄る操作。2本指のときだけ動くので、家具のドラッグとは取り合わない。
// 写真がまだ無いうちは効かせない（寄る相手が無いのに3Dだけ拡大されると訳が分からない）
// 寸法の画面でも効かせる（線の端を細かく合わせるため）。画面を出ると入る前の見え方に戻る（photoState の setScaling）
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
  // 影を受ける面は写真モードだけ。部屋モードには本物の床があり、そちらが影を受ける。
  // 部屋の主光源は写真モードでは影を落とさない（向きの違う影が 2 つ重なるため）
  photoShadow.group.visible = photo;
  depthOccluder.group.visible = photo;
  depthOccluder.frontGroup.visible = photo;
  lighting.setCastShadow(!photo);
  applyScaling();

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
    // 写真から出した画角も戻す。残すと部屋モードまで広角で描かれる
    viewer.setPhotoView(null);
    viewer.setPhotoFov(null);
    viewer.setContentAspect(null);
  }
}

function applyBackground(): void {
  const { backgroundUrl, maskUrl, isMasking } = photoState.get();
  const image = backgroundUrl ? `url("${backgroundUrl}")` : '';
  viewer.photoLayer.style.backgroundImage = image;

  // 指定している間だけ、同じ写真を塗った形で切り抜いて重ね、色を被せて見せる
  // （家具を隠すのは、物ごとの見えない板。core/maskRegions.ts）
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
  const { backgroundAspect, view, floorFit, vfovDeg } = photoState.get();

  viewer.setContentAspect(backgroundAspect);
  viewer.setPhotoFov(vfovDeg);
  applyPhotoCamera(viewer.camera, floorFit, photoCameraHeight());
  viewer.setPhotoView(view);
  // 手前の物の面は、写真を描いているカメラと同じ所から、手前に表示する範囲の板の奥行きを広げる
  depthOccluder.followCamera(viewer.camera);
  depthOccluder.setSource(occluderSource());
  depthOccluder.setFrontBoxes(frontBoxes());
}

/**
 * 写真の物に隠さず手前に描く家具（新しく置いて、まだ動かしていないもの）の箱。
 * 切り抜きの板はカメラの方を向き、傾けることもあるので、どの向きでも板が収まる大きさにする
 */
function frontBoxes(): FrontBox[] {
  return photoState.get().furniture.filter((item) => item.inFront).map((item) => {
    const [w, h, d] = item.size;
    const reach = Math.hypot(w, h);
    const size: [number, number, number] = isBillboard(item) ? [reach, reach, reach] : [w, h, d];
    return { position: item.position, size, rotationY: item.rotationY };
  });
}

/** 新しい家具を置く場所の、画面の横の位置（NDC）。真ん中。縦の位置は photoState が決める（隠れなければ下から 3 割） */
const PLACEMENT_SCREEN_X = 0;

/** 画面の点（3D を描いている範囲の NDC、-1〜1）に写っている、写真の点 */
function photoPointOfNdc(x: number, y: number): PhotoPoint {
  return photoPointAt(photoState.get().view, { u: (x + 1) / 2, v: (1 - y) / 2 });
}

// 奥行きから家具の位置を出すときの画角。いま写真を描いているカメラのものを使う
setLensSource(() => ({ vfovDeg: viewer.camera.fov, aspect: viewer.camera.aspect }));
// 室内の寸法を計算してあれば、その点の奥行きに置く。まだなら、立って撮った前提の床に置く
setPhotoPlacement((y) => {
  const x = PLACEMENT_SCREEN_X;
  const onDepth = depthPointAt(photoPointOfNdc(x, y));
  if (onDepth) return onDepth;
  const hit = floorPointOnScreen(viewer.camera, x, y);
  return hit ? [hit.x, hit.y, hit.z] : null;
});

modeState.subscribe(applyMode);
photoState.subscribe(applyBackground);
photoState.subscribe(applyPhotoView);
/**
 * 寸法を合わせている間の見せ方。線を写真の上の層に描く。
 *
 * **家具と影は隠す。** 線を合わせる物が家具に隠れないように。画面を閉じると元どおり出す
 */
function applyScaling(): void {
  const { isScaling, scaleLines, selectedScaleLine, view } = photoState.get();
  const scaling = isPhotoMode() && isScaling;
  photoFurniture.group.visible = isPhotoMode() && !isScaling;
  photoShadow.group.visible = isPhotoMode() && !isScaling;
  photoShadow.setGrounds(false, groundsOf(photoState.get().furniture));
  drawScaleLines(viewer.overlayLayer, scaling ? scaleLines : [], selectedScaleLine, view);
}
photoState.subscribe(applyScaling);
modeState.subscribe(applyScaling);
// 線の層は大きさが変わると中身が消える（画素数を合わせ直すため）。描き直す
new ResizeObserver(applyScaling).observe(viewer.overlayLayer);
applyMode();
applyBackground();

// --- UI ---
header.appendChild(createModeSwitch());
createBottomSheet(app);

// --- 端末に残す ---
persistRoomOnChange();
persistPhotoOnChange();
// 保存した背景と部屋の一覧に出すアイコン。いま見えているもの（写真と家具、または部屋）を縮めて作る
setSnapshotSource((kind) => captureSnapshot(kind === 'photo'));
// 前回の生成・切り抜きが終わっていれば、ここで保管庫に入る
resumeGeneration();
resumeCutouts();
watchWallet();

/**
 * いま見えているものを縮めた画像にする（一覧のアイコン）。
 *
 * 写真モードは、写真の層（CSS の背景画像）と家具を描いたキャンバスを、画面上の位置どおりに重ねる。
 * 下のシートは入れない。部屋モードはキャンバスだけ。
 * キャンバスは描いた直後にしか読めない（preserveDrawingBuffer を切ってある）ので、ここで 1 度描いてから写す。
 * 縦長（3:4）に真ん中を切り抜き、長辺 480px の JPEG にする
 */
async function captureSnapshot(photo: boolean): Promise<Blob | null> {
  const viewportRect = viewport.getBoundingClientRect();
  if (viewportRect.width === 0 || viewportRect.height === 0) return null;
  const width = 360;
  const height = 480;
  const scale = Math.max(width / viewportRect.width, height / viewportRect.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = photo ? '#1f2326' : THEME.background;
  context.fillRect(0, 0, width, height);
  // 画面の真ん中が切り抜きの真ん中に来るように寄せる
  const offsetX = (width - viewportRect.width * scale) / 2;
  const offsetY = (height - viewportRect.height * scale) / 2;
  const place = (rect: DOMRect): [number, number, number, number] => [
    offsetX + (rect.left - viewportRect.left) * scale,
    offsetY + (rect.top - viewportRect.top) * scale,
    rect.width * scale,
    rect.height * scale,
  ];
  if (photo) {
    const url = photoState.get().backgroundUrl;
    if (url) {
      const image = new Image();
      image.src = url;
      try {
        await image.decode();
        context.drawImage(image, ...place(viewer.photoLayer.getBoundingClientRect()));
      } catch {
        // 写真が読めなければ家具だけになる
      }
    }
  }
  viewer.renderer.render(viewer.scene, viewer.camera);
  context.drawImage(viewer.canvas, ...place(viewer.canvas.getBoundingClientRect()));
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85));
}

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
