/**
 * 写真から家具を切り抜く一連の流れ。
 *
 * 3D 生成（generation.ts）と同じく**預けて、あとで取りに行く**。写真を送ると受付番号が
 * 返り、切り抜きはサーバー側で進む。こちらは 2 秒ごとに状態を見に行き、できあがったら
 * PNG を取って端末に保存し、保管庫（modelLibrary.ts）に入れる。**できあがっても勝手には置かない。**
 *
 * 待ち状態は端末に残す（localStorage）。iPhone は PWA を裏に回すと数秒で通信を切るので、
 * 楽天のページに URL をコピーしに行く間にも切り抜きは失われない。裏にいる間は見に行かず、
 * 戻ってきた時点・次に開いた時点で続きを見に行く。
 */

import { createStore } from '@/core/store';
import { shrinkForUpload } from '@/core/imageResize';
import {
  ApiError,
  createCutoutJob,
  getCutoutJob,
  getCutoutResult,
  importProduct,
  type CutoutJobStatus,
} from '@/platform/api';
import { CUTOUT_RETRY_INTERVAL_MS, CUTOUT_TOTAL_TIMEOUT_MS } from '@/config/api';
import { ensureRegistered } from '@/platform/auth';
import { addModel, modelNameFrom } from '@/core/modelLibrary';
import { saveCutout } from '@/platform/cutoutCache';
import { deletePreview, resolvePreview, savePreview } from '@/platform/previewCache';
import type { ProductInfo } from '@/config/furniture';

const STORAGE_KEY = 'roomplanner.cutouts';

export type CutoutPhase = 'importing' | 'uploading' | 'cutting' | 'saving' | 'failed';

/** サーバー側の段階のうち、途中のもの（done / failed は phase に畳む） */
export type CutoutServerPhase = 'queued' | 'running';

/** 保管庫に入れるときの、写真からは分からない情報（商品の取り込みだけが持つ） */
export interface CutoutExtras {
  name?: string;
  size?: [number, number, number];
  product?: ProductInfo;
}

export interface CutoutJob {
  /** 端末内での識別子。サーバーの受付番号が届く前から使う */
  id: string;
  /** サーバーの受付番号。預けるまでは null */
  jobId: string | null;
  fileName: string;
  /** 元写真の縮小プレビュー。切り抜いている間のサムネイルに出す */
  previewKey: string | null;
  previewUrl: string | null;
  /** 端末側の段階。取り込み中・送る前・預けた（サーバーで進行中）・保存中・失敗 */
  phase: CutoutPhase;
  /** 受付時刻（epoch ms）。諦める判断に使う */
  startedAt: number;
  /** サーバーが実際に何をしているか。最初の応答が来るまでは null */
  serverPhase: CutoutServerPhase | null;
  /** 推論にかかりそうな秒数。サーバーが直近の実測から出した値 */
  expectedSeconds: number | null;
  /**
   * いまの工程に入った時刻（epoch ms）。円は工程の中をこれからの経過で進める。
   * 預けたあとはサーバーが返す経過秒から逆算する（端末の時計とずれても狂わない）
   */
  phaseStartedAt: number;
  extras: CutoutExtras;
  error: string | null;
}

export interface CutoutState {
  jobs: CutoutJob[];
}

export const cutoutState = createStore<CutoutState>({ jobs: [] });

/** 端末に残す形。預けたものだけ。写真そのもの（プレビュー）は previewCache にある */
interface SavedCutout {
  jobId: string;
  fileName: string;
  previewKey: string | null;
  startedAt: number;
  extras: CutoutExtras;
}

function persist(state: CutoutState): void {
  try {
    const pending = state.jobs.filter(
      (job) => job.jobId && (job.phase === 'cutting' || job.phase === 'saving')
    );
    if (pending.length > 0) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          pending.map<SavedCutout>(({ jobId, fileName, previewKey, startedAt, extras }) => ({
            jobId: jobId!,
            fileName,
            previewKey,
            startedAt,
            extras,
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

function setState(patch: Partial<CutoutState>): void {
  cutoutState.set(patch);
  persist(cutoutState.get());
}

/**
 * 円の進み方。サーバーの工程ごとに持ち分を決め、工程の中は経過秒で補間する。
 * 3D の core/progress.ts と同じ考え方で、持ち分を超えたら止まって次の工程を待つ
 * （止まるのは正直な表示で、実際に長引いているという情報になる）。
 *
 *   順番待ち（queued、まだ応答が無いときも）… 0 → 10%。起動待ちは実測 15〜20 秒
 *   running                                … 10% → 90%。秒数はサーバーが返した見込み
 *   saving（結果を取って端末に保存）       … 90% → 97%。1 秒ほど
 */
const QUEUED_SECONDS = 20;
const SAVING_SECONDS = 1;
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

  if (job.phase === 'importing') return { ratio: 0, label: '商品を取り込み中' };
  if (job.phase === 'uploading') return { ratio: 0, label: '送信中' };
  if (job.phase === 'saving') {
    return {
      ratio: Math.min(
        SHARE.starting + SHARE.cutting + SHARE.finishing * within(SAVING_SECONDS),
        MAX_RATIO
      ),
      label: '保存中',
    };
  }
  switch (job.serverPhase) {
    case null:
    case 'queued':
      return { ratio: SHARE.starting * within(QUEUED_SECONDS), label: '準備中' };
    case 'running': {
      const seconds = job.expectedSeconds ?? QUEUED_SECONDS;
      return { ratio: SHARE.starting + SHARE.cutting * within(seconds), label: '切り抜き中' };
    }
  }
}

function updateJob(id: string, patch: Partial<CutoutJob>): void {
  setState({
    jobs: cutoutState.get().jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)),
  });
}

function removeJob(id: string): void {
  setState({ jobs: cutoutState.get().jobs.filter((job) => job.id !== id) });
}

function newJob(fileName: string, phase: CutoutPhase): CutoutJob {
  return {
    id: crypto.randomUUID(),
    jobId: null,
    fileName,
    previewKey: null,
    previewUrl: null,
    phase,
    startedAt: Date.now(),
    serverPhase: null,
    expectedSeconds: null,
    phaseStartedAt: Date.now(),
    extras: {},
    error: null,
  };
}

/**
 * 写真を送って切り抜きを頼む。完成を待たずに返る。
 * 各写真の進み方は cutoutState を購読して見る
 */
export async function startCutout(files: File[]): Promise<void> {
  const jobs = files.map((file) => newJob(file.name, 'uploading'));
  if (jobs.length === 0) return;

  setState({ jobs: [...cutoutState.get().jobs, ...jobs] });
  try {
    await ensureRegistered();
  } catch (error) {
    for (const job of jobs) updateJob(job.id, { phase: 'failed', error: toMessage(error) });
    return;
  }

  await Promise.all(jobs.map((job, index) => submit(job.id, files[index])));
}

/**
 * 楽天の商品ページの URL から取り込む。
 *
 * サーバーが商品情報と画像を返すので、その画像を写真と同じ切り抜きの流れに通す。
 * 寸法が取れていれば置くときの大きさに、商品情報は「楽天で見る」に使う。
 *
 * **画面からの入口は廃止した**（「家具を追加」は 2D / 3D の 2 つだけ）。
 * すでに取り込んである家具の店名・購入リンクは残すため、ここから下は残してある。
 * 取り込みそのものを畳むかは、サーバー側の扱いと合わせて決める
 */
export async function startProductImport(url: string): Promise<void> {
  const job = newJob('商品', 'importing');
  const id = job.id;
  setState({ jobs: [...cutoutState.get().jobs, job] });
  try {
    await ensureRegistered();
    const product = await importProduct(url);
    // 一覧や失敗表示に出す名前。商品名そのものは検索用の言葉が並んで長い
    updateJob(id, { fileName: productName(product.name) });
    const file = new File([product.image], 'product.jpg', { type: product.image.type });
    await submit(id, file, {
      name: productName(product.name),
      size: product.size ? [product.size.w, product.size.h, product.size.d] : undefined,
      product: {
        shop: product.shop,
        name: product.name,
        price: product.price,
        url: product.url,
        affiliateUrl: product.affiliateUrl,
      },
    });
  } catch (error) {
    updateJob(id, { phase: 'failed', error: toMessage(error) });
  }
}

/** 商品名は長い（検索用の言葉が並ぶ）ので、一覧に出す名前は先頭だけにする */
function productName(name: string): string {
  const head = name.replace(/【[^】]*】/g, ' ').trim().split(/\s+/).slice(0, 3).join(' ');
  return (head || name).slice(0, 24) || '商品';
}

async function submit(id: string, file: File, extras: CutoutExtras = {}): Promise<void> {
  try {
    const preview = await savePreview(id, file);
    if (preview) updateJob(id, { previewKey: preview.key, previewUrl: preview.url });
    const image = await shrinkForUpload(file);
    const { id: jobId, expectedSeconds } = await createCutoutJob(image);
    updateJob(id, {
      jobId,
      extras,
      expectedSeconds,
      phase: 'cutting',
      startedAt: Date.now(),
      phaseStartedAt: Date.now(),
    });
    await watch(id, jobId);
  } catch (error) {
    updateJob(id, { phase: 'failed', error: toMessage(error) });
  }
}

/**
 * 前回の続きを見に行く。起動時に一度だけ呼ぶ。
 *
 * アプリを閉じている間に切り抜きが終わっていることが多い。復帰した時点で
 * できあがっていれば、そのまま保管庫に入る
 */
export function resumeCutouts(): void {
  let saved: Partial<SavedCutout>[] = [];
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    saved = Array.isArray(value) ? value : [];
  } catch {
    saved = [];
  }
  const jobs = saved
    .filter((item): item is SavedCutout => typeof item.jobId === 'string')
    .map<CutoutJob>((item) => ({
      ...newJob(item.fileName || '写真から作った家具', 'cutting'),
      jobId: item.jobId,
      previewKey: item.previewKey ?? null,
      startedAt: item.startedAt ?? Date.now(),
      extras: item.extras ?? {},
    }));
  if (jobs.length === 0) return;

  setState({ jobs: [...cutoutState.get().jobs, ...jobs] });
  for (const job of jobs) {
    if (job.previewKey) void restorePreview(job.id, job.previewKey);
    void watch(job.id, job.jobId!);
  }
}

async function restorePreview(id: string, key: string): Promise<void> {
  const url = await resolvePreview(key);
  if (url) updateJob(id, { previewUrl: url });
}

/**
 * できあがるまで見に行く。
 *
 * 一定間隔で叩くのではなく、「いま知っている工程」を渡してサーバーに待ってもらう
 * （工程が変わればその時点で返る）。1 件で 3 回ほどの要求で済む。
 * 画面が裏にいる間は見に行かない（iOS は裏の通信を切るので、失敗と区別がつかない）。
 * 表に戻った瞬間に見に行く。裏にいた時間は諦める判断に数えない
 */
async function watch(id: string, jobId: string): Promise<void> {
  let retryAfterError = false;
  while (true) {
    if (retryAfterError) await sleep(CUTOUT_RETRY_INTERVAL_MS);
    retryAfterError = false;
    await untilVisible();

    const current = cutoutState.get().jobs.find((job) => job.id === id);
    if (!current || current.jobId !== jobId || current.phase !== 'cutting') return;

    if (Date.now() - current.startedAt > CUTOUT_TOTAL_TIMEOUT_MS) {
      updateJob(id, { phase: 'failed', error: '時間がかかりすぎたため中断しました。もう一度お試しください' });
      return;
    }

    let status: CutoutJobStatus;
    try {
      status = await getCutoutJob(jobId, current.serverPhase);
    } catch (error) {
      // 通信が切れただけかもしれない（裏に回った直後など）ので、少し待って見に行く。
      // 無くなっていた（2 日で消える）ならここで諦める
      if (error instanceof ApiError && error.status === 404) {
        updateJob(id, { phase: 'failed', error: '切り抜きの結果が見つかりませんでした。もう一度お試しください' });
        return;
      }
      retryAfterError = true;
      continue;
    }

    if (status.phase === 'failed') {
      updateJob(id, { phase: 'failed', error: status.error ?? '切り抜きに失敗しました。もう一度お試しください' });
      return;
    }
    if (status.phase === 'queued' || status.phase === 'running') {
      // 工程の基準時刻はサーバーの経過秒から逆算する。端末の時計とずれても円が狂わない
      updateJob(id, {
        serverPhase: status.phase,
        expectedSeconds: status.expectedSeconds ?? current.expectedSeconds,
        phaseStartedAt: Date.now() - status.elapsed * 1000,
      });
      continue;
    }

    await finish(id, jobId);
    return;
  }
}

/** できあがった切り抜きを取って端末に保存し、保管庫に入れる */
async function finish(id: string, jobId: string): Promise<void> {
  try {
    updateJob(id, { phase: 'saving', phaseStartedAt: Date.now() });
    const png = await getCutoutResult(jobId);
    const key = await saveCutout(crypto.randomUUID(), png);
    // アイコンは切り抜きそのもの。透過のまま縮めると JPEG で黒く潰れるので、
    // サムネイルの下地と同じ色を敷く
    const icon = await savePreview(crypto.randomUUID(), png, { background: '#e6e2dc' });
    if (icon) URL.revokeObjectURL(icon.url);
    const job = cutoutState.get().jobs.find((item) => item.id === id);
    const extras = job?.extras ?? {};
    addModel({
      id: crypto.randomUUID(),
      name: extras.name ?? modelNameFrom(job?.fileName ?? ''),
      modelKey: null,
      imageKey: key,
      previewKey: icon?.key ?? job?.previewKey ?? null,
      size: extras.size,
      product: extras.product,
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

/** 画面が表に出るまで待つ。表にいればすぐ返る */
function untilVisible(): Promise<void> {
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = (): void => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', onChange);
      resolve();
    };
    document.addEventListener('visibilitychange', onChange);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  if (error instanceof Error) return error.message;
  return '切り抜きに失敗しました。もう一度お試しください';
}
