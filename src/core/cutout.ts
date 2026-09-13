/**
 * 写真から家具を切り抜く一連の流れ。
 *
 * 3D 生成（generation.ts）と違い、**数秒で終わる同期の処理**。
 * サーバーは結果を持たないので、返ってきた PNG をその場で端末に保存し、
 * 保管庫（modelLibrary.ts）に入れる。**できあがっても勝手には置かない。**
 *
 * 待ち状態は端末に残さない。数秒の間にアプリを閉じたら、その 1 枚は
 * やり直してもらう（8 分かかる 3D 生成のように、復帰して続きを見に行く価値が無い）。
 */

import { createStore } from '@/core/store';
import { shrinkForUpload } from '@/core/imageResize';
import { ApiError, createCutout, type CutoutEvent } from '@/platform/api';
import { ensureRegistered } from '@/platform/auth';
import { addModel, modelNameFrom } from '@/core/modelLibrary';
import { saveCutout } from '@/platform/cutoutCache';
import { deletePreview, savePreview } from '@/platform/previewCache';

export type CutoutPhase = 'uploading' | 'cutting' | 'saving' | 'failed';

/** サーバーが流してくる工程のうち、途中のもの（done / failed は phase に畳む） */
export type CutoutServerPhase = 'received' | 'cutting' | 'finishing';

export interface CutoutJob {
  id: string;
  fileName: string;
  /** 元写真の縮小プレビュー。切り抜いている間のサムネイルに出す */
  previewKey: string | null;
  previewUrl: string | null;
  /** 端末側の段階。送る前・送った・保存中・失敗 */
  phase: CutoutPhase;
  /**
   * サーバーが実際に何をしているか。送ってから 1 行目が届くまでは null で、
   * その間がコールドスタート（サーバーの起動待ち）
   */
  serverPhase: CutoutServerPhase | null;
  /** 推論にかかりそうな秒数。サーバーが直近の実測から出した値。cutting の行で届く */
  expectedSeconds: number | null;
  /** いまの工程に入った時刻（epoch ms）。円は工程の中をこれからの経過で進める */
  phaseStartedAt: number;
  error: string | null;
}

export interface CutoutState {
  jobs: CutoutJob[];
}

export const cutoutState = createStore<CutoutState>({ jobs: [] });

/**
 * 円の進み方。サーバーの工程ごとに持ち分を決め、工程の中は経過秒で補間する。
 * 3D の core/progress.ts と同じ考え方で、持ち分を超えたら止まって次の工程を待つ
 * （止まるのは正直な表示で、実際に長引いているという情報になる）。
 *
 *   起動待ち（serverPhase が null）… 0 → 10%。コールドスタートは実測 15 秒
 *   received / cutting            … 10% → 90%。秒数はサーバーが返した見込み
 *   finishing                     … 90% → 97%。PNG 化は 0.5 秒ほど
 *   saving（端末に保存）          … 97% で待つ
 */
const COLD_START_SECONDS = 15;
const FINISHING_SECONDS = 0.5;
const SHARE = { starting: 0.1, cutting: 0.8, finishing: 0.07 } as const;
/** 満杯にしない上限。最後で止まると「終わったのに終わらない」に見える */
const MAX_RATIO = 0.99;

export interface CutoutProgress {
  ratio: number;
  label: string;
}

/** いまの進み具合と、いま何をしているか */
export function cutoutProgress(job: CutoutJob, now = Date.now()): CutoutProgress {
  const elapsed = Math.max(0, (now - job.phaseStartedAt) / 1000);
  const within = (seconds: number): number => Math.min(elapsed / seconds, 1);

  if (job.phase === 'uploading') return { ratio: 0, label: '送っています' };
  if (job.phase === 'saving') {
    return { ratio: SHARE.starting + SHARE.cutting + SHARE.finishing, label: '保存しています' };
  }
  switch (job.serverPhase) {
    case null:
      return { ratio: SHARE.starting * within(COLD_START_SECONDS), label: '起動を待っています' };
    case 'received':
    case 'cutting': {
      const seconds = job.expectedSeconds ?? COLD_START_SECONDS;
      return { ratio: SHARE.starting + SHARE.cutting * within(seconds), label: '切り抜いています' };
    }
    case 'finishing':
      return {
        ratio: Math.min(
          SHARE.starting + SHARE.cutting + SHARE.finishing * within(FINISHING_SECONDS),
          MAX_RATIO
        ),
        label: '仕上げています',
      };
  }
}

function updateJob(id: string, patch: Partial<CutoutJob>): void {
  cutoutState.set({
    jobs: cutoutState.get().jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)),
  });
}

function removeJob(id: string): void {
  cutoutState.set({ jobs: cutoutState.get().jobs.filter((job) => job.id !== id) });
}

/**
 * 写真を送って切り抜きを頼む。完成を待たずに返る。
 * 各写真の進み方は cutoutState を購読して見る
 */
export async function startCutout(files: File[]): Promise<void> {
  const jobs = files.map<CutoutJob>((file) => ({
    id: crypto.randomUUID(),
    fileName: file.name,
    previewKey: null,
    previewUrl: null,
    phase: 'uploading',
    serverPhase: null,
    expectedSeconds: null,
    phaseStartedAt: Date.now(),
    error: null,
  }));
  if (jobs.length === 0) return;

  cutoutState.set({ jobs: [...cutoutState.get().jobs, ...jobs] });
  try {
    await ensureRegistered();
  } catch (error) {
    for (const job of jobs) updateJob(job.id, { phase: 'failed', error: toMessage(error) });
    return;
  }

  await Promise.all(jobs.map((job, index) => submit(job.id, files[index])));
}

async function submit(id: string, file: File): Promise<void> {
  try {
    const preview = await savePreview(id, file);
    if (preview) updateJob(id, { previewKey: preview.key, previewUrl: preview.url });
    const image = await shrinkForUpload(file);
    updateJob(id, { phase: 'cutting', phaseStartedAt: Date.now() });
    const png = await createCutout(image, (event) => rememberProgress(id, event));

    updateJob(id, { phase: 'saving', phaseStartedAt: Date.now() });
    const key = await saveCutout(crypto.randomUUID(), png);
    // アイコンは切り抜きそのもの。透過のまま縮めると JPEG で黒く潰れるので、
    // サムネイルの下地と同じ色を敷く
    const icon = await savePreview(crypto.randomUUID(), png, { background: '#e6e2dc' });
    if (icon) URL.revokeObjectURL(icon.url);
    const job = cutoutState.get().jobs.find((item) => item.id === id);
    addModel({
      id: crypto.randomUUID(),
      name: modelNameFrom(job?.fileName ?? ''),
      modelKey: null,
      imageKey: key,
      previewKey: icon?.key ?? job?.previewKey ?? null,
      createdAt: Date.now(),
    });
    // 元写真のプレビューは切り抜いている間だけのもの。アイコンが別に作れたなら捨てる
    if (icon && job?.previewKey) void deletePreview(job.previewKey);
    if (job?.previewUrl) URL.revokeObjectURL(job.previewUrl);
    removeJob(id);
  } catch (error) {
    updateJob(id, { phase: 'failed', error: toMessage(error) });
  }
}

/**
 * サーバーが言ってきた工程を覚える。工程が変わったときだけ基準時刻を更新する
 * （received → cutting は間を置かず続けて届くので、cutting の時刻を基準にする）
 */
function rememberProgress(id: string, event: CutoutEvent): void {
  if (event.phase === 'done' || event.phase === 'failed') return;
  updateJob(id, {
    serverPhase: event.phase,
    expectedSeconds: event.phase === 'cutting' ? event.expectedSeconds : undefined,
    phaseStartedAt: Date.now(),
  });
}

/** 指定した失敗表示だけを閉じる。他の切り抜きは続ける */
export function dismissCutoutError(id: string): void {
  const job = cutoutState.get().jobs.find((item) => item.id === id);
  if (job?.phase !== 'failed') return;
  if (job.previewKey) void deletePreview(job.previewKey);
  if (job.previewUrl) URL.revokeObjectURL(job.previewUrl);
  removeJob(id);
}

function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  // AbortSignal.timeout は TimeoutError という名前の DOMException を投げる
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return '時間内に返ってきませんでした。もう一度お試しください';
  }
  if (error instanceof Error) return error.message;
  return '切り抜けませんでした';
}
