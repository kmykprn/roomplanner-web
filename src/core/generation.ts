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
import { ApiError, createJob, getJob, type JobStatus } from '@/platform/api';
import { ensureRegistered } from '@/platform/auth';
import { saveModel } from '@/platform/modelCache';
import { deletePreview, resolvePreview, savePreview } from '@/platform/previewCache';
import { POLL_INTERVAL_MS, RUN_TIMEOUT_MS, TOTAL_TIMEOUT_MS } from '@/config/api';

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
  /** 元写真の縮小プレビュー。端末に保存したキーと表示用URLを分けて持つ */
  previewKey: string | null;
  previewUrl: string | null;
  phase: GenerationPhase;
  /** 受付時刻（epoch ms）。全体の打ち切り判断に使う */
  startedAt: number | null;
  /**
   * 実行が始まった時刻（epoch ms）。待機列に並んでいる間は null。
   *
   * **打ち切りをここから測る。** 受付から測ると、待機列が伸びたぶんだけ
   * 実行時間の見積もりが食われ、サーバーが作れているのに画面が捨ててしまう
   */
  startedRunningAt: number | null;
  /**
   * サーバー側の工程。まだ分からないときは null。
   *
   * 画面側の `phase`（uploading / queued …）とは別物。あちらは端末の都合、
   * こちらはサーバーが実際に何をしているか
   */
  serverPhase: string | null;
  /**
   * その工程が始まった時刻（**端末の時計での** epoch ms）。
   *
   * サーバーからは経過秒で受け取り、受け取った時点で端末の時刻に直す。
   * こうしておくと、15秒に1回しか見に行かなくても、その間の円は
   * 端末側で滑らかに進められる
   */
  serverPhaseStartedAt: number | null;
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
          pending.map(({ jobId, fileName, previewKey, startedAt }) => ({
            jobId,
            fileName,
            previewKey,
            startedAt,
          }))
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
    previewKey: null,
    previewUrl: null,
    phase: 'uploading',
    startedAt: null,
    startedRunningAt: null,
    serverPhase: null,
    serverPhaseStartedAt: null,
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
    const preview = await savePreview(id, file);
    if (preview) updateJob(id, { previewKey: preview.key, previewUrl: preview.url });
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
  let saved: Array<{ jobId?: string; fileName?: string; previewKey?: string; startedAt?: number }> = [];
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
      previewKey: job.previewKey ?? null,
      previewUrl: null,
      phase: 'queued',
      startedAt: job.startedAt ?? Date.now(),
      // 実行中だったかどうかは端末に残していない。復帰後に最初の応答で分かる
      startedRunningAt: null,
      serverPhase: null,
      serverPhaseStartedAt: null,
      error: null,
    }));
  if (jobs.length === 0) return;

  setState({ jobs: [...generationState.get().jobs, ...jobs] });
  for (const job of jobs) {
    if (job.previewKey) void restorePreview(job.id, job.previewKey);
    void watch(job.id, job.jobId!);
  }
}

async function restorePreview(id: string, key: string): Promise<void> {
  const url = await resolvePreview(key);
  if (url) updateJob(id, { previewUrl: url });
}

/** 完成するまで一定間隔で見に行く */
async function watch(id: string, jobId: string): Promise<void> {
  // 待たずに1回目を叩く。開き直した直後に工程が分かるようにするため。
  // 先に15秒待つと、その間だけ円が「順番待ち」に戻って見える
  let first = true;

  while (true) {
    // 生成に8分かかるので、細かく叩いても分かることは増えない
    if (!first) await sleep(POLL_INTERVAL_MS);
    first = false;

    const current = generationState.get().jobs.find((job) => job.id === id);
    if (!current || current.jobId !== jobId) return;

    if (isOverdue(current)) {
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
    rememberProgress(id, status);
    if (status.state === 'queued' || status.state === 'running') continue;

    await place(id, jobId, status.modelUrl);
    return;
  }
}

/**
 * 打ち切ってよいか。
 *
 * **実行が始まってからの時間と、受付からの時間を別々に見る。**
 * サーバーは待機列を持つので、受付から実行開始までにいくらでも間が空きうる。
 * 受付からの一本で測ると、待った時間のぶんだけ実行ぶんの見積もりが食われ、
 * **サーバーは作れているのに画面が捨てる**（回数は消費済みなので戻らない）。
 *
 * 待機がいつまでも終わらない場合の歯止めとして、受付からの上限も残す。
 */
function isOverdue(job: GenerationJob): boolean {
  const now = Date.now();
  if (job.startedRunningAt !== null && now - job.startedRunningAt > RUN_TIMEOUT_MS) return true;
  return now - (job.startedAt ?? 0) > TOTAL_TIMEOUT_MS;
}

/**
 * サーバーが言ってきた進み具合を覚える。
 *
 * **工程が変わったときだけ基準時刻を更新する。** 毎回入れ直すと、通信にかかった
 * ぶんだけ基準がうしろにずれて、円がわずかに巻き戻る。工程の中では端末の時計だけで
 * 進めておき、切り替わりでサーバーに合わせ直すほうが、見え方が安定する
 */
function rememberProgress(id: string, status: JobStatus): void {
  const current = generationState.get().jobs.find((job) => job.id === id);
  if (!current) return;

  const patch: Partial<GenerationJob> = {};
  if (status.state === 'queued' || status.state === 'running') patch.phase = status.state;
  // 実行が始まった瞬間を1度だけ控える。打ち切りの起点になる
  if (status.state === 'running' && !current.startedRunningAt) {
    patch.startedRunningAt = Date.now();
  }
  const serverPhase = status.phase ?? null;
  if (serverPhase !== current.serverPhase) {
    patch.serverPhase = serverPhase;
    patch.serverPhaseStartedAt = Date.now() - (status.phaseElapsedSeconds ?? 0) * 1000;
  }
  if (Object.keys(patch).length > 0) updateJob(id, patch);
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
    const job = generationState.get().jobs.find((item) => item.id === id);
    addFurniture({
      id: crypto.randomUUID(),
      typeId: 'generated',
      name: '写真から作った家具',
      position: findFreePosition(GENERATED_SIZE),
      rotationY: 0,
      size: [...GENERATED_SIZE],
      color: PLACEHOLDER_COLOR,
      modelUrl: key,
      sourceImageKey: job?.previewKey ?? undefined,
      sourceImageName: job?.fileName,
    });
    removeJob(id);
  } catch (error) {
    updateJob(id, { phase: 'failed', error: toMessage(error) });
  }
}

/** 指定した失敗表示だけを閉じる。他の作成は続ける。 */
export function dismissError(id: string): void {
  const job = generationState.get().jobs.find((item) => item.id === id);
  if (job?.phase !== 'failed') return;
  if (job.previewKey) void deletePreview(job.previewKey);
  removeJob(id);
}

function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '生成に失敗しました';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
