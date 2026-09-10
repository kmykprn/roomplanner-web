/**
 * 写真から家具を作る一連の流れを受け持つ。
 *
 * 生成には約8分かかる。その間ユーザーはアプリを閉じられるし、リロードもする。
 * **待っている状態を端末に残し、開き直したら続きから見に行く**のがこのファイルの主眼。
 * 複数の写真は個別のジョブとして扱い、完成したものから部屋へ置く。
 */

import { createStore } from '@/core/store';
import { addFurniture, findFreePosition } from '@/core/appState';
import { shrinkForUpload } from '@/core/imageResize';
import { ApiError, createJob, getJob } from '@/platform/api';
import { ensureRegistered } from '@/platform/auth';
import { saveModel } from '@/platform/modelCache';
import { POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from '@/config/api';

/**
 * 生成した家具の大きさ。
 *
 * 写真からは実寸が分からないので、いちばん長い辺が 1m に収まるようにする。
 * 縦横の比率はモデルのまま保たれる（modelLoader を参照）。
 */
const GENERATED_SIZE: [number, number, number] = [1, 1, 1];

/** 生成した家具の色。GLB が読めるまでの箱に使うだけ */
const PLACEHOLDER_COLOR = '#bdb2a7';

const STORAGE_KEY = 'roomplanner.generations';

export type GenerationPhase =
  | 'uploading'
  | 'queued'
  | 'running'
  | 'placing'
  | 'failed';

export interface GenerationJob {
  /** 端末内での識別子。サーバーの jobId が届く前から使う */
  id: string;
  jobId: string | null;
  fileName: string;
  phase: GenerationPhase;
  /** 開始時刻（epoch ms）。経過時間の表示と、諦める判断に使う */
  startedAt: number | null;
  error: string | null;
}

export interface GenerationState {
  jobs: GenerationJob[];
}

const initial: GenerationState = { jobs: [] };

export const generationState = createStore<GenerationState>(initial);

/** 未完了のジョブだけを端末に残す。完了・失敗後に復元しないため。 */
function persist(state: GenerationState): void {
  try {
    const pending = state.jobs.filter(
      (job) => job.jobId && (job.phase === 'queued' || job.phase === 'running')
    );
    if (pending.length > 0) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          pending.map(({ jobId, fileName, startedAt }) => ({ jobId, fileName, startedAt }))
        )
      );
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // プライベートモードなどで localStorage が使えないことがある。
    // 保存できなくても、そのセッションのうちは動き続けられる
  }
}

function setState(patch: Partial<GenerationState>): void {
  generationState.set(patch);
  persist(generationState.get());
}

function updateJob(id: string, patch: Partial<GenerationJob>): void {
  setState({
    jobs: generationState.get().jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)),
  });
}

function removeJob(id: string): void {
  setState({ jobs: generationState.get().jobs.filter((job) => job.id !== id) });
}

/**
 * 写真を送って生成を頼む。
 *
 * 完成を待たずに返る。選択した各写真の進み方は generationState を購読して見る。
 */
export async function startGeneration(files: File[]): Promise<void> {
  const jobs = files.map<GenerationJob>((file) => ({
    id: crypto.randomUUID(),
    jobId: null,
    fileName: file.name,
    phase: 'uploading',
    startedAt: null,
    error: null,
  }));
  if (jobs.length === 0) return;

  setState({ jobs: [...generationState.get().jobs, ...jobs] });
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
    const image = await shrinkForUpload(file);
    const jobId = await createJob(image);
    updateJob(id, { jobId, phase: 'queued', startedAt: Date.now(), error: null });
    void watch(id, jobId);
  } catch (error) {
    updateJob(id, { phase: 'failed', error: toMessage(error) });
  }
}

/**
 * 前回の続きを見に行く。起動時に一度だけ呼ぶ。
 *
 * アプリを閉じている間に生成が終わっていることもあるので、
 * 復帰した時点で完成していれば、そのまま部屋に置かれる。
 */
export function resumeGeneration(): void {
  let saved: Array<{ jobId?: string; fileName?: string; startedAt?: number }> = [];
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    saved = Array.isArray(value) ? value : [];
  } catch {
    saved = [];
  }
  const jobs = saved
    .filter((job): job is Required<typeof job> => Boolean(job.jobId))
    .map<GenerationJob>((job) => ({
      id: crypto.randomUUID(),
      jobId: job.jobId,
      fileName: job.fileName || '写真から作成した家具',
      phase: 'queued',
      startedAt: job.startedAt ?? Date.now(),
      error: null,
    }));
  if (jobs.length === 0) return;

  setState({ jobs: [...generationState.get().jobs, ...jobs] });
  for (const job of jobs) void watch(job.id, job.jobId!);
}

/** 完成するまで一定間隔で見に行く */
async function watch(id: string, jobId: string): Promise<void> {
  while (true) {
    // 生成に8分かかるので、細かく叩いても分かることは増えない
    await sleep(POLL_INTERVAL_MS);

    const current = generationState.get().jobs.find((job) => job.id === id);
    if (!current || current.jobId !== jobId) return;

    if (Date.now() - (current.startedAt ?? 0) > POLL_TIMEOUT_MS) {
      updateJob(id, {
        phase: 'failed',
        error: '時間内に終わりませんでした。時間をおいて試してください',
      });
      return;
    }

    let status;
    try {
      status = await getJob(jobId);
    } catch (error) {
      // 通信が切れただけかもしれないので、続けて見に行く。
      // 認証や権限の問題なら、次も同じように失敗して諦めることになる
      if (error instanceof ApiError && error.status === 404) {
        updateJob(id, { phase: 'failed', error: '生成の記録が見つかりませんでした' });
        return;
      }
      continue;
    }

    if (status.state === 'failed') {
      updateJob(id, {
        phase: 'failed',
        error: status.error ?? '生成に失敗しました',
      });
      return;
    }
    if (status.state === 'queued' || status.state === 'running') {
      updateJob(id, { phase: status.state });
      continue;
    }

    await place(id, jobId, status.modelUrl);
    return;
  }
}

/** 完成したモデルを端末に保存してから部屋に置く */
async function place(id: string, jobId: string, modelUrl?: string): Promise<void> {
  if (!modelUrl) {
    updateJob(id, { phase: 'failed', error: '完成したモデルの場所が分かりません' });
    return;
  }
  updateJob(id, { phase: 'placing' });
  try {
    // 署名付きURLは1時間で切れる。中身を先に保存してから置く
    const key = await saveModel(jobId, modelUrl);
    addFurniture({
      id: crypto.randomUUID(),
      typeId: 'generated',
      name: '写真から作った家具',
      position: findFreePosition(GENERATED_SIZE),
      rotationY: 0,
      size: [...GENERATED_SIZE],
      color: PLACEHOLDER_COLOR,
      modelUrl: key,
    });
    removeJob(id);
  } catch (error) {
    updateJob(id, { phase: 'failed', error: toMessage(error) });
  }
}

/** 指定した失敗表示だけを閉じる。他の作成は続ける。 */
export function dismissError(id: string): void {
  const job = generationState.get().jobs.find((item) => item.id === id);
  if (job?.phase === 'failed') removeJob(id);
}

function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '生成に失敗しました';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
