/**
 * 部屋と写真の状態を端末に残す。
 *
 * 生成に8分かかるものを置いた直後にリロードで消える、という状態を避けるため。
 * 「アプリを閉じても残る」を成立させるには、待ち状態（generation.ts）だけでなく
 * **置いた家具そのもの**も残す必要がある。
 *
 * 保存先は localStorage。部屋と家具の一覧は数KBにしかならないので十分で、
 * 同期的に読めるぶん起動時の扱いが単純になる。
 * GLB の中身は大きいので Cache Storage に分けてある（modelCache.ts）。
 *
 * **背景と部屋は何組も持てる（core/sceneLibrary.ts）。** 残すのは「いま開いているもの」の鍵（id 付き）へ。
 * 開くものが切り替わったら、ここの loadPhoto / loadRoom で中身を入れ替える（sceneLibrary が呼ぶ）
 */

import { withCurrentSampleAssets } from '@/config/samples';
import { appState, type AppState } from '@/core/appState';
import { editSession } from '@/core/editHistory';
import { DEFAULT_INTERIOR, DEFAULT_MATS, roomSizeFor } from '@/config/interior';
import { photoState, resetPhotoState, restoreDepth, setMaskUrl, settledView, showBackground, startAnalysis, type FittedScale, type PhotoState } from '@/core/photoState';
import { readBackground, readDepth, readMask } from '@/platform/backgroundStore';
import { normalizeFloorFit } from '@/core/floorFit';
import { normalizeScaleLine, normalizeScaleLines } from '@/core/scaleLine';
import { photoDataKey, roomDataKey, sceneLibrary, setSaveFlusher, setSceneLoader, touchScene } from '@/core/sceneLibrary';
import type { PlacedFurniture } from '@/config/furniture';

/** localStorage に残す写真モードの項目。写真そのものは大きいので IndexedDB（backgroundStore.ts） */
type SavedPhoto = Pick<
  PhotoState,
  | 'furniture' | 'view' | 'backgroundName' | 'floorFit' | 'vfovDeg' | 'lensFocal35'
  | 'cameraHeight' | 'scaleLines' | 'depthScale'
>;

/**
 * 部屋を読み戻す。起動時は**シーンを組み立てる前**に呼ぶ。開く部屋を切り替えたときも呼ぶ（sceneLibrary）。
 * null なら新しい空の部屋（既定の内装、家具なし）。
 *
 * 壊れた値が入っていても起動できなくならないよう、読めなければ既定のまま進む。
 */
export function loadRoom(id: string | null): void {
  loading += 1;
  try {
    applyRoom(id ? readSaved<Partial<AppState>>(roomDataKey(id)) : null);
  } finally {
    loading -= 1;
  }
}

function applyRoom(saved: Partial<AppState> | null): void {
  if (!saved) {
    appState.set({
      room: roomSizeFor(DEFAULT_INTERIOR, DEFAULT_MATS),
      interior: { template: DEFAULT_INTERIOR, mats: DEFAULT_MATS },
      furniture: [],
      selectedId: null,
    });
    return;
  }

  // 選択状態は残さない。前回選んでいた家具が消えている可能性があり、
  // 復元しても操作の手掛かりにならない
  const interior = { template: DEFAULT_INTERIOR, mats: DEFAULT_MATS, ...(saved.interior ?? {}) };
  appState.set({
    // 部屋の大きさは内装（畳数）から決まるので、保存値ではなく内装から引き直す
    room: roomSizeFor(interior.template, interior.mats),
    interior,
    furniture: withBaseSize(saved.furniture),
    selectedId: null,
  });
}

/**
 * 置いたときの大きさを、覚えていない記録に補う。
 *
 * 「大きさ」のバーは置いたときの何倍かで動くので、基準が無いと真ん中が決まらない。
 * この項目より前に置いた家具には、いまの大きさをそのまま基準として入れる
 * （その家具にとっては、いまが「置いたとき」になる）
 */
function withBaseSize(furniture: unknown): PlacedFurniture[] {
  if (!Array.isArray(furniture)) return [];
  return (furniture as PlacedFurniture[]).map((item) =>
    // 置いたサンプルの中身の URL も今の版のものにする（以前の版の URL では読めない。config/samples.ts）
    withCurrentSampleAssets(item.baseSize ? item : { ...item, baseSize: [...item.size] as [number, number, number] })
  );
}

/** 何回目の読み込みか。読み戻しの途中で別の背景に切り替わったら、古いほうの写真を出さない */
let photoLoad = 0;

/**
 * 写真モードを読み戻す。起動時と、開く背景を切り替えたとき（sceneLibrary）に呼ぶ。
 * null なら新しい空の背景（写真なし、家具なし）。
 *
 * 家具と寄り具合は同期的に戻し、写真そのものは IndexedDB から非同期に読んで
 * 出す。写真が残っていなければ「未選択」のまま（家具だけ残っていてもよい。
 * 写真を選び直せばそのまま乗る）
 */
export function loadPhoto(id: string | null): void {
  photoLoad += 1;
  const load = photoLoad;
  loading += 1;
  try {
    applyPhoto(id ? readSaved<Partial<SavedPhoto>>(photoDataKey(id)) : null, load);
  } finally {
    loading -= 1;
  }
}

/**
 * 読み込みの最中か。最中は保存しない。
 * 読み込みは「前のものを捨てる → 入れる」の 2 段階で状態を書き換えるので、途中の空の状態が
 * 開いたばかりのものの鍵に書かれてしまう（開いた直後に中身が消える）
 */
let loading = 0;

function applyPhoto(saved: Partial<SavedPhoto> | null, load: number): void {
  // 前に開いていた背景の写真・計算・家具を全部捨ててから入れる
  resetPhotoState();
  if (!saved) return;

  photoState.set({
    furniture: withBaseSize(saved.furniture),
    view: saved.view ?? photoState.get().view,
    // 壊れた値が入っていても起動できるよう、読めなければ既定の傾きに戻す
    floorFit: normalizeFloorFit(saved.floorFit),
    vfovDeg: Number.isFinite(saved.vfovDeg) ? (saved.vfovDeg as number) : null,
    lensFocal35: Number.isFinite(saved.lensFocal35) && (saved.lensFocal35 as number) > 0 ? (saved.lensFocal35 as number) : null,
    // 撮った高さ。以前の版の保存には無い（その写真は立って撮った前提の高さのまま。家具もその高さで置いてある）
    cameraHeight: Number.isFinite(saved.cameraHeight) && (saved.cameraHeight as number) > 0 ? (saved.cameraHeight as number) : null,
    // 寸法の線と、線に合わせた奥行きの直し方。壊れていれば「まだ合わせていない」に戻す
    scaleLines: restoredScaleLines(saved),
    depthScale: normalizeFittedScale(saved.depthScale),
    backgroundName: saved.backgroundName ?? null,
    // 写真の名前が残っていれば、前に写真を選んでいた。読み戻す間も写真があるときと同じ画面にする
    backgroundStatus: saved.backgroundName ? 'restoring' : 'idle',
    selectedId: null,
  });

  /** 読み戻しをやめて「写真が無い」に戻す。読み戻す間に別の写真を選んでいたら何もしない */
  const giveUp = (): void => {
    if (load !== photoLoad) return;
    if (photoState.get().backgroundStatus === 'restoring') photoState.set({ backgroundStatus: 'idle', backgroundName: null });
  };

  readBackground()
    .then(async (blob) => {
      // 読み戻す間に別の背景に切り替わった、または別の写真を選んでいたら、古い写真で上書きしない
      if (load !== photoLoad) return;
      if (!['restoring', 'idle'].includes(photoState.get().backgroundStatus)) return;
      if (!blob) {
        // 名前だけ残って写真が無い状態にしない
        giveUp();
        return;
      }
      if (!(await showBackground(blob))) return;
      if (load !== photoLoad) return;
      // 隠す場所は写真に付いているものなので、写真が出せたときだけ戻す
      const mask = await readMask();
      if (load !== photoLoad) return;
      if (mask) setMaskUrl(URL.createObjectURL(mask));
      // 室内の寸法を計算した奥行きも、写真に付いているものなので同じく戻す
      const depthMap = await readDepth();
      if (load !== photoLoad) return;
      if (depthMap) restoreDepth(depthMap);
      // 奥行きが残っていなければ（以前の版で選んだ写真など）、裏で解析する
      else startAnalysis();
    })
    .catch(() => {
      // 読めなくても起動は続ける。写真を選び直せばよい
      giveUp();
    });
}

/**
 * 寸法の線を読み戻す。線が 1 本だけだったころの保存（scaleLine）も 1 本の一覧として読む
 */
function restoredScaleLines(saved: Partial<SavedPhoto> & { scaleLine?: unknown }): PhotoState['scaleLines'] {
  if (saved.scaleLines) return normalizeScaleLines(saved.scaleLines);
  const single = normalizeScaleLine(saved.scaleLine);
  return single ? [single] : [];
}

/** 奥行きの直し方を読み戻す。数でなければ「まだ合わせていない」 */
function normalizeFittedScale(value: unknown): FittedScale | null {
  const scale = value as Partial<FittedScale> | null;
  if (!scale || !Number.isFinite(scale.a) || !Number.isFinite(scale.b)) return null;
  return { a: scale.a as number, b: scale.b as number, lines: normalizeScaleLines(scale.lines) };
}

/** 壊れた値が入っていても起動できなくならないよう、読めなければ null にする */
function readSaved<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

/**
 * 保存を頼まれたら保存する。**ただし指で触っている間は保存せず、離したときにまとめて 1 回保存する。**
 * 家具をドラッグしたりバーを動かしたりすると、1 秒に何十回も状態が変わる。そのたびに端末へ書くのは無駄
 * （書き込みは同期的で、動かしている最中の指の動きを重くする）。
 * 離す合図が来ないままページを閉じたときのために、閉じる前にも保存する
 */
function saveAfterEdit(save: () => void): () => void {
  let waiting = false;
  const flush = (): void => {
    if (!waiting) return;
    waiting = false;
    if (loading > 0) return;
    save();
  };
  editSession.subscribe(({ editing }) => {
    if (!editing) flush();
  });
  window.addEventListener('pagehide', flush);
  flushes.push(flush);
  return () => {
    waiting = true;
    if (!editSession.get().editing) flush();
  };
}

/** 溜まっている保存を全部書き出す関数。開くものを切り替える前に sceneLibrary が呼ぶ（切り替えたあとに前のものの鍵へ書かないように） */
const flushes: Array<() => void> = [];

export function flushSaves(): void {
  for (const flush of flushes) flush();
}

/** 読み込みと書き出しを sceneLibrary につなぐ。起動時に一度だけ呼ぶ */
export function connectSceneLibrary(): void {
  setSceneLoader('photo', loadPhoto);
  setSceneLoader('room', loadRoom);
  setSaveFlusher(flushSaves);
}

/** 変化したら保存する。起動時に一度だけ呼ぶ */
export function persistRoomOnChange(): void {
  const request = saveAfterEdit(() => {
    // 開いている部屋が無ければ残さない（空の状態を編集している。一覧から新しく作ると id が付く）
    const id = sceneLibrary.get().current.room;
    if (!id) return;
    const state = appState.get();
    try {
      // 選択状態は保存しない（上と同じ理由）
      localStorage.setItem(
        roomDataKey(id),
        JSON.stringify({ room: state.room, interior: state.interior, furniture: state.furniture })
      );
      touchScene(id);
    } catch {
      // 容量超過やプライベートモード。保存できなくても操作は続けられる
    }
  });
  appState.subscribe(request);
}

/** 変化したら保存する。起動時に一度だけ呼ぶ */
export function persistPhotoOnChange(): void {
  const request = saveAfterEdit(() => {
    const id = sceneLibrary.get().current.photo;
    if (!id) return;
    const state = photoState.get();
    // 読み込みと読み戻しの途中は残さない。名前だけ先に入って写真が無い、という中途半端を防ぐ
    // （読み戻しの途中に残すと、写真の名前が消え、次に開いたときに読み戻す間の画面が「写真が無い」になる）
    if (state.backgroundStatus === 'loading' || state.backgroundStatus === 'restoring') return;
    const saved: SavedPhoto = {
      furniture: state.furniture,
      // 寸法の画面で一時的に寄っている間は、入る前の見え方を残す
      view: settledView(),
      floorFit: state.floorFit,
      vfovDeg: state.vfovDeg,
      lensFocal35: state.lensFocal35,
      cameraHeight: state.cameraHeight,
      scaleLines: state.scaleLines,
      depthScale: state.depthScale,
      backgroundName: state.backgroundStatus === 'ready' ? state.backgroundName : null,
    };
    try {
      localStorage.setItem(photoDataKey(id), JSON.stringify(saved));
      touchScene(id);
    } catch {
      // 容量超過やプライベートモード。保存できなくても操作は続けられる
    }
  });
  photoState.subscribe(request);
}
