/**
 * 写真から家具を作る一連の流れを受け持つ。
 *
 * 生成には約8分かかる。その間ユーザーはアプリを閉じられるし、リロードもする。
 * **待っている状態を端末に残し、開き直したら続きから見に行く**のがこのファイルの主眼。
 *
 * 同時に走らせられるのは1件だけ。サーバー側も409で弾くので、
 * 画面の状態も1件ぶんしか持たない。
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

const STORAGE_KEY = 'roomplanner.generation';

export type GenerationPhase =
  | 'idle'
  | 'uploading'
  | 'waiting'
  | 'placing'
  | 'failed';

export interface GenerationState {
  phase: GenerationPhase;
  /** 受付番号。待っている間だけ入る */
  jobId: string | null;
  /** 開始時刻（epoch ms）。経過時間の表示と、諦める判断に使う */
  startedAt: number | null;
  /** 失敗したときに画面へ出す文言 */
  error: string | null;
}

const initial: GenerationState = { phase: 'idle', jobId: null, startedAt: null, error: null };

export const generationState = createStore<GenerationState>(initial);

/** 待ち状態だけを端末に残す。完了・失敗したら消す */
function persist(state: GenerationState): void {
  try {
    if (state.phase === 'waiting' && state.jobId) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ jobId: state.jobId, startedAt: state.startedAt })
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

/**
 * 写真を送って生成を頼む。
 *
 * 完成を待たずに返る。以後の進み方は generationState を購読して見る。
 */
export async function startGeneration(file: File): Promise<void> {
  if (generationState.get().phase === 'waiting') return;

  setState({ phase: 'uploading', error: null, jobId: null, startedAt: null });
  try {
    // お金がかかる操作なので、本登録が要るならここで求める（いまは素通り）
    await ensureRegistered();

    const image = await shrinkForUpload(file);
    const jobId = await createJob(image);

    setState({ phase: 'waiting', jobId, startedAt: Date.now() });
    void watch(jobId);
  } catch (error) {
    setState({ phase: 'failed', error: toMessage(error), jobId: null, startedAt: null });
  }
}

/**
 * 前回の続きを見に行く。起動時に一度だけ呼ぶ。
 *
 * アプリを閉じている間に生成が終わっていることもあるので、
 * 復帰した時点で完成していれば、そのまま部屋に置かれる。
 */
export function resumeGeneration(): void {
  let saved: { jobId?: string; startedAt?: number } | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    saved = null;
  }
  if (!saved?.jobId) return;

  setState({ phase: 'waiting', jobId: saved.jobId, startedAt: saved.startedAt ?? Date.now() });
  void watch(saved.jobId);
}

/** 完成するまで一定間隔で見に行く */
async function watch(jobId: string): Promise<void> {
  while (true) {
    // 生成に8分かかるので、細かく叩いても分かることは増えない
    await sleep(POLL_INTERVAL_MS);

    // 別の生成が始まった、または画面側で取り消された場合は降りる
    const current = generationState.get();
    if (current.jobId !== jobId) return;

    if (Date.now() - (current.startedAt ?? 0) > POLL_TIMEOUT_MS) {
      setState({
        phase: 'failed',
        error: '時間内に終わりませんでした。時間をおいて試してください',
        jobId: null,
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
        setState({ phase: 'failed', error: '生成の記録が見つかりませんでした', jobId: null });
        return;
      }
      continue;
    }

    if (status.state === 'failed') {
      setState({
        phase: 'failed',
        error: status.error ?? '生成に失敗しました',
        jobId: null,
      });
      return;
    }
    if (status.state !== 'succeeded') continue;

    await place(jobId, status.modelUrl);
    return;
  }
}

/** 完成したモデルを端末に保存してから部屋に置く */
async function place(jobId: string, modelUrl?: string): Promise<void> {
  if (!modelUrl) {
    setState({ phase: 'failed', error: '完成したモデルの場所が分かりません', jobId: null });
    return;
  }
  setState({ phase: 'placing' });
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
    setState({ phase: 'idle', jobId: null, startedAt: null, error: null });
  } catch (error) {
    setState({ phase: 'failed', error: toMessage(error), jobId: null });
  }
}

/** 失敗の表示を消す。次の生成を始められる状態に戻す */
export function dismissError(): void {
  if (generationState.get().phase !== 'failed') return;
  setState({ phase: 'idle', error: null });
}

function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '生成に失敗しました';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
