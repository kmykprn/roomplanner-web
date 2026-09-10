/**
 * 写真から家具を作るパネル。
 *
 * 生成に約8分かかるので、**待たせる画面ではなく、待たせない画面**にする。
 * 押したあとはタブを離れても、アプリを閉じても進行は続く。
 * ここは進み具合を映すだけで、進行そのものは generation.ts が持っている。
 */

import { pickImage } from '@/platform/picker';
import { getUid } from '@/platform/auth';
import { IS_CONFIGURED } from '@/config/api';
import { EXPECTED_TOTAL_SECONDS, progressFor } from '@/core/progress';
import { createProgressRing } from '@/ui/progressRing';
import {
  dismissError,
  generationState,
  startGeneration,
  type GenerationState,
} from '@/core/generation';

export function createGenerationPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'row';

  const status = document.createElement('p');
  status.className = 'hint';

  // 待っている間だけ出す。8分かかるので、動いていることが目で分かる必要がある
  const ring = createProgressRing();
  const progress = document.createElement('div');
  progress.className = 'progress';
  progress.append(ring.element, status);

  const startButton = document.createElement('button');
  startButton.className = 'button';
  startButton.textContent = '写真を選んで作る';
  startButton.addEventListener('click', async () => {
    const file = await pickImage();
    if (file) void startGeneration(file);
  });

  const retryButton = document.createElement('button');
  retryButton.className = 'button';
  retryButton.textContent = 'とじる';
  retryButton.addEventListener('click', dismissError);

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

  panel.append(progress, startButton, retryButton, identity);

  function render(state: GenerationState): void {
    // 待っている間だけ円を出す。それ以外は説明文だけで足りる
    ring.setVisible(state.phase === 'waiting');
    if (state.phase === 'waiting') {
      const progress = progressFor(state.serverPhase, elapsedInPhase(state));
      ring.update(progress.ratio, progress.centerText);
    }

    startButton.hidden = state.phase !== 'idle';
    // 認証できていないなら押しても必ず失敗する。押せなくしておく
    startButton.disabled = authFailed;
    retryButton.hidden = state.phase !== 'failed';

    const failed = state.phase === 'failed' || authFailed;
    status.classList.toggle('is-error', failed);
    status.textContent = authFailed ? authFailureMessage() : describe(state);
  }

  render(generationState.get());
  generationState.subscribe(render);

  // 待っている間、状態そのものは変わらないので購読だけでは経過時間が止まる。
  // 8分待たせる画面で数字が動かないと、固まったように見える
  setInterval(() => {
    if (generationState.get().phase === 'waiting') render(generationState.get());
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

/** いま何が起きているかを 1 行で伝える */
function describe(state: GenerationState): string {
  switch (state.phase) {
    case 'idle':
      return `家具の写真から3Dモデルを作ります（約${Math.round(EXPECTED_TOTAL_SECONDS / 60)}分）`;
    case 'uploading':
      return '写真を送っています…';
    case 'waiting': {
      const progress = progressFor(state.serverPhase, elapsedInPhase(state));
      // その工程が実測より長引いているときは、そう言う。
      // 円が止まって見える理由が分かるほうが、待つ側は不安にならない
      const suffix = progress.isOverrunning
        ? '（思ったより時間がかかっています）'
        : '。この画面を閉じても続きます';
      return progress.label + suffix;
    }
    case 'placing':
      return 'できあがりました。部屋に置いています…';
    case 'failed':
      return state.error ?? '生成に失敗しました';
  }
}

/**
 * いまの工程に入ってから何秒経ったか。
 *
 * 基準はサーバーが返した経過秒を端末の時刻に直したもの（generation.ts が持つ）。
 * まだ工程が分かっていないうちは、受付からの経過をそのまま使う
 */
function elapsedInPhase(state: GenerationState): number {
  const base = state.serverPhaseStartedAt ?? state.startedAt;
  if (!base) return 0;
  return Math.max(0, Math.floor((Date.now() - base) / 1000));
}
