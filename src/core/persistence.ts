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
 */

import { withCurrentSampleAssets } from '@/config/samples';
import { appState, type AppState } from '@/core/appState';
import { editSession } from '@/core/editHistory';
import { roomSizeFor } from '@/config/interior';
import { photoState, restoreDepth, setMaskUrl, settledView, showBackground, startAnalysis, type FittedScale, type PhotoState } from '@/core/photoState';
import { readBackground, readDepth, readMask } from '@/platform/backgroundStore';
import { normalizeFloorFit } from '@/core/floorFit';
import { normalizeScaleLine, normalizeScaleLines } from '@/core/scaleLine';
import type { PlacedFurniture } from '@/config/furniture';

const STORAGE_KEY = 'roomplanner.room';
const PHOTO_STORAGE_KEY = 'roomplanner.photo';

/** localStorage に残す写真モードの項目。写真そのものは大きいので IndexedDB（backgroundStore.ts） */
type SavedPhoto = Pick<
  PhotoState,
  | 'furniture' | 'view' | 'backgroundName' | 'floorFit' | 'vfovDeg' | 'lensFocal35'
  | 'cameraHeight' | 'scaleLines' | 'depthScale'
>;

/**
 * 保存した状態を読み戻す。**シーンを組み立てる前**に呼ぶ。
 *
 * 壊れた値が入っていても起動できなくならないよう、読めなければ既定のまま進む。
 */
export function restoreRoom(): void {
  const saved = readSaved<Partial<AppState>>(STORAGE_KEY);
  if (!saved) return;

  // 選択状態は残さない。前回選んでいた家具が消えている可能性があり、
  // 復元しても操作の手掛かりにならない
  const interior = { ...appState.get().interior, ...(saved.interior ?? {}) };
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

/**
 * 写真モードを読み戻す。
 *
 * 家具と寄り具合は同期的に戻し、写真そのものは IndexedDB から非同期に読んで
 * 出す。写真が残っていなければ「未選択」のまま（家具だけ残っていてもよい。
 * 写真を選び直せばそのまま乗る）
 */
export function restorePhoto(): void {
  const saved = readSaved<Partial<SavedPhoto>>(PHOTO_STORAGE_KEY);
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
    if (photoState.get().backgroundStatus === 'restoring') photoState.set({ backgroundStatus: 'idle', backgroundName: null });
  };

  readBackground()
    .then(async (blob) => {
      // 読み戻す間に別の写真を選んでいたら、古い写真で上書きしない
      if (!['restoring', 'idle'].includes(photoState.get().backgroundStatus)) return;
      if (!blob) {
        // 名前だけ残って写真が無い状態にしない
        giveUp();
        return;
      }
      if (!(await showBackground(blob))) return;
      // 隠す場所は写真に付いているものなので、写真が出せたときだけ戻す
      const mask = await readMask();
      if (mask) setMaskUrl(URL.createObjectURL(mask));
      // 室内の寸法を計算した奥行きも、写真に付いているものなので同じく戻す
      const depthMap = await readDepth();
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
    save();
  };
  editSession.subscribe(({ editing }) => {
    if (!editing) flush();
  });
  window.addEventListener('pagehide', flush);
  return () => {
    waiting = true;
    if (!editSession.get().editing) flush();
  };
}

/** 変化したら保存する。起動時に一度だけ呼ぶ */
export function persistRoomOnChange(): void {
  const request = saveAfterEdit(() => {
    const state = appState.get();
    try {
      // 選択状態は保存しない（上と同じ理由）
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ room: state.room, interior: state.interior, furniture: state.furniture })
      );
    } catch {
      // 容量超過やプライベートモード。保存できなくても操作は続けられる
    }
  });
  appState.subscribe(request);
}

/** 変化したら保存する。起動時に一度だけ呼ぶ */
export function persistPhotoOnChange(): void {
  const request = saveAfterEdit(() => {
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
      localStorage.setItem(PHOTO_STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // 容量超過やプライベートモード。保存できなくても操作は続けられる
    }
  });
  photoState.subscribe(request);
}
