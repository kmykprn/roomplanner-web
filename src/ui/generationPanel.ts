/**
 * 写真から家具を作るパネル。
 *
 * 生成に約8分かかるので、**待たせる画面ではなく、待たせない画面**にする。
 * 押したあとはタブを離れても、アプリを閉じても進行は続く。
 * ここは進み具合を映すだけで、進行そのものは generation.ts が持っている。
 */

import { pickImages } from '@/platform/picker';
import { getUid } from '@/platform/auth';
import { EXPECTED_DURATION_SECONDS, IS_CONFIGURED } from '@/config/api';
import { createProgressRing } from '@/ui/progressRing';
import {
  dismissError,
  generationState,
  startGeneration,
  type GenerationJob,
  type GenerationState,
} from '@/core/generation';

export function createGenerationPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'row';

  const status = document.createElement('p');
  status.className = 'hint';
  status.textContent = `家具の写真から3Dモデルを作ります（約${Math.round(EXPECTED_DURATION_SECONDS / 60)}分）`;

  const jobs = document.createElement('div');
  jobs.className = 'generation-jobs';

  const startButton = document.createElement('button');
  startButton.className = 'button';
  startButton.textContent = '写真を選んで作る';
  startButton.addEventListener('click', async () => {
    const files = await pickImages();
    if (files.length > 0) void startGeneration(files);
  });

  // 限定公開のうちは、この識別子をサーバー側の許可リストに登録してもらう必要がある。
  // 個人情報は含まれない（匿名アカウントなので紐づく情報が無い）。
  // 全員が使えるようになったら、この表示ごと消してよい
  const identity = document.createElement('details');
  identity.className = 'identity';
  const summary = document.createElement('summary');
  summary.textContent = '利用者ID';
  const uidText = document.createElement('code');
  uidText.textContent = '取得中…';
  identity.append(summary, uidText);

  // 認証できないとこのあと何をしても失敗する。
  // 黙って「取得中…」のまま止まると原因が分からないので、画面に出す
  let authFailed = false;
  void getUid()
    .then((uid) => {
      uidText.textContent = uid;
    })
    .catch(() => {
      authFailed = true;
      uidText.textContent = '取得できませんでした';
      render(generationState.get());
    });

  panel.append(status, jobs, startButton, identity);

  function render(state: GenerationState): void {
    startButton.disabled = authFailed;
    status.classList.toggle('is-error', authFailed);
    status.textContent = authFailed
      ? authFailureMessage()
      : state.jobs.length === 0
        ? `家具の写真から3Dモデルを作ります（約${Math.round(EXPECTED_DURATION_SECONDS / 60)}分）`
        : '';
    jobs.replaceChildren(...state.jobs.map(createJobStatus));
  }

  render(generationState.get());
  generationState.subscribe(render);

  // 待っている間、状態そのものは変わらないので購読だけでは経過時間が止まる。
  // 8分待たせる画面で数字が動かないと、固まったように見える
  setInterval(() => {
    if (generationState.get().jobs.some((job) => job.phase === 'running')) {
      render(generationState.get());
    }
  }, 1000);

  return panel;
}

/**
 * 認証できなかった理由。
 *
 * 設定の入れ忘れと、通信や鍵の問題は、利用者がすべきことが違う。
 * 前者は開き直しても直らないので、そう伝える
 */
function authFailureMessage(): string {
  return IS_CONFIGURED
    ? '認証できませんでした。通信を確かめて開き直してください'
    : 'この配信には生成の設定が入っていません（管理者にお伝えください）';
}

function createJobStatus(job: GenerationJob): HTMLElement {
  const row = document.createElement('div');
  row.className = 'generation-job';

  const name = document.createElement('p');
  name.className = 'generation-job__name';
  name.textContent = job.fileName;

  const message = document.createElement('p');
  message.className = 'hint';
  message.textContent = describe(job);

  const content = document.createElement('div');
  content.className = 'generation-job__content';
  content.append(name, message);

  const visual = document.createElement('div');
  visual.className = 'generation-job__visual';
  if (job.previewUrl) {
    const thumbnail = document.createElement('img');
    thumbnail.className = 'generation-job__thumbnail';
    thumbnail.src = job.previewUrl;
    thumbnail.alt = `${job.fileName} のプレビュー`;
    visual.append(thumbnail);
  }

  if (job.phase === 'running') {
    const ring = createProgressRing();
    const seconds = elapsedSeconds(job.startedAt);
    ring.update(seconds / EXPECTED_DURATION_SECONDS, remaining(seconds));
    visual.append(ring.element);
  }
  visual.append(content);
  row.append(visual);

  if (job.phase === 'failed') {
    message.classList.add('is-error');
    const closeButton = document.createElement('button');
    closeButton.className = 'button';
    closeButton.textContent = 'とじる';
    closeButton.addEventListener('click', () => dismissError(job.id));
    row.append(closeButton);
  }
  return row;
}

function describe(job: GenerationJob): string {
  switch (job.phase) {
    case 'uploading':
      return '写真を送っています…';
    case 'queued':
      return '作成を受け付けました。開始まで少しお待ちください';
    case 'running':
      return '3Dモデルを作成中です';
    case 'placing':
      return 'できあがりました。部屋に置いています…';
    case 'failed':
      return job.error ?? '作成できませんでした';
  }
}

function elapsedSeconds(startedAt: number | null): number {
  if (!startedAt) return 0;
  return Math.floor((Date.now() - startedAt) / 1000);
}

/**
 * 円の中央に出す残り時間。
 *
 * **これは見込みであって約束ではない。** 想定を超えたら数字を出すのをやめ、
 * 「まもなく」に切り替える。減らない数字を見せ続けるより正直で、
 * 「止まっているのでは」という不安も生みにくい
 */
function remaining(elapsedSec: number): string {
  const left = EXPECTED_DURATION_SECONDS - elapsedSec;
  if (left <= 0) return 'まもなく';
  const minutes = Math.ceil(left / 60);
  return `あと${minutes}分`;
}
