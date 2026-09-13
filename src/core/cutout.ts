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
import { ApiError, createCutout } from '@/platform/api';
import { ensureRegistered } from '@/platform/auth';
import { addModel, modelNameFrom } from '@/core/modelLibrary';
import { saveCutout } from '@/platform/cutoutCache';
import { deletePreview, savePreview } from '@/platform/previewCache';

export type CutoutPhase = 'uploading' | 'cutting' | 'saving' | 'failed';

export interface CutoutJob {
  id: string;
  fileName: string;
  /** 元写真の縮小プレビュー。切り抜いている間のサムネイルに出す */
  previewKey: string | null;
  previewUrl: string | null;
  phase: CutoutPhase;
  /** 送り始めた時刻（epoch ms）。円の進み具合の目安に使う */
  startedAt: number;
  error: string | null;
}

export interface CutoutState {
  jobs: CutoutJob[];
}

export const cutoutState = createStore<CutoutState>({ jobs: [] });

/**
 * 1 枚の目安の秒数。円はこの時間で 9 割まで進み、そこで待つ。
 * 実測は 5〜7 秒、コールドスタートが乗ると 15 秒ほど
 */
export const EXPECTED_SECONDS = 12;

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
    startedAt: Date.now(),
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
    updateJob(id, { phase: 'cutting' });
    const png = await createCutout(image);

    updateJob(id, { phase: 'saving' });
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
