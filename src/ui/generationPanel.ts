/**
 * 写真から家具を作るパネル。
 *
 * 生成に約8分かかるので、**待たせる画面ではなく、待たせない画面**にする。
 * 押したあとはタブを離れても、アプリを閉じても進行は続く。
 * ここは進み具合を映すだけで、進行そのものは generation.ts が持っている。
 */

import { pickImage } from '@/platform/picker';
import { getUid } from '@/platform/auth';
import { EXPECTED_DURATION_SECONDS } from '@/config/api';
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

  panel.append(status, startButton, retryButton, identity);

  function render(state: GenerationState): void {
    startButton.hidden = state.phase !== 'idle';
    // 認証できていないなら押しても必ず失敗する。押せなくしておく
    startButton.disabled = authFailed;
    retryButton.hidden = state.phase !== 'failed';

    const failed = state.phase === 'failed' || authFailed;
    status.classList.toggle('is-error', failed);
    status.textContent = authFailed
      ? '認証できませんでした。通信を確かめて開き直してください'
      : describe(state);
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

/** いま何が起きているかを 1 行で伝える */
function describe(state: GenerationState): string {
  switch (state.phase) {
    case 'idle':
      return `家具の写真から3Dモデルを作ります（約${Math.round(EXPECTED_DURATION_SECONDS / 60)}分）`;
    case 'uploading':
      return '写真を送っています…';
    case 'waiting':
      return `作成中です（${elapsed(state.startedAt)}）。この画面を閉じても続きます`;
    case 'placing':
      return 'できあがりました。部屋に置いています…';
    case 'failed':
      return state.error ?? '生成に失敗しました';
  }
}

/** 経過時間。8分待たせるので「動いていること」が分かる情報を出す */
function elapsed(startedAt: number | null): string {
  if (!startedAt) return '経過時間ふめい';
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`;
}
