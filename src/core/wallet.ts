/**
 * 財布（3D を作れる残りの回数）。
 *
 * 残高はサーバーが持つ（Hunyuan3D-2GP の api/SPEC.md「財布」）。ここはその写しで、
 * 画面が「お試し あと 2 回」のように出すためのもの。
 *
 * 写しを取り直すのは次の 3 つのとき。
 *   1. Google に紐づいたアカウントになったとき（匿名には財布が無い。お試しは生涯で数えるため）
 *   2. 3D の作成を頼んだ直後（1 回減る）
 *   3. 3D の作成が失敗したとき（こちら都合なら 1 回戻る）
 */

import { createStore } from '@/core/store';
import { authState } from '@/platform/auth';
import { getWallet, type Wallet } from '@/platform/api';

export interface WalletState extends Wallet {
  /**
   * idle: 匿名なので財布が無い / loading: 取りに行っている /
   * ready: 写しがある / failed: 取れなかった（残高が分からないだけで、作成は頼める）
   */
  status: 'idle' | 'loading' | 'ready' | 'failed';
}

export const walletState = createStore<WalletState>({
  status: 'idle',
  credits: 0,
  trialRemaining: 0,
  noBanner: false,
});

/** 3D を作れる残り回数（お試しと券の合計）。写しが無ければ null */
export function remainingGenerations(state: WalletState = walletState.get()): number | null {
  if (state.status !== 'ready') return null;
  return state.trialRemaining + state.credits;
}

/** サーバーの残高を取り直す。匿名なら何もしない */
export async function refreshWallet(): Promise<void> {
  const { status, anonymous } = authState.get();
  if (status !== 'ready' || anonymous) {
    walletState.set({ status: 'idle' });
    return;
  }
  walletState.set({ status: 'loading' });
  try {
    const wallet = await getWallet();
    walletState.set({ status: 'ready', ...wallet });
  } catch {
    // 残高が分からなくても作成は頼める（サーバーが最終判断をする）。画面は既定の案内に戻る
    walletState.set({ status: 'failed' });
  }
}

/** ログインの状態に合わせて財布を持ち直す。起動時に一度だけ呼ぶ */
export function watchWallet(): void {
  let lastUid: string | null = null;
  authState.subscribe(({ status, uid, anonymous }) => {
    // 同じアカウントのままなら取り直さない（購読は状態の更新のたびに呼ばれる）
    const key = status === 'ready' && !anonymous ? uid : null;
    if (key === lastUid) return;
    lastUid = key;
    void refreshWallet();
  });
}
