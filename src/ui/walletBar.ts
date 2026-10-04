/**
 * 「家具を追加」の画面のいちばん上に出す、3D を作れる残りの回数の帯。
 *
 *   ログインしている       … 「3D 作成　残り 3 回」と、右に金色の枠の［購入］
 *   回数を数えない設定     … 「3D 作成　回数無制限」（開発者のアカウント。ボタンは出さない）
 *   ログインしていない     … 「3D 作成　残り 3 回」（お試しの回数）と、右に［ログイン］
 *
 * 回数はお試しと回数券を分けずに合計で出す。利用者から見ればどちらも「作れる回数」で、分けても次の行動が変わらない。
 * ［購入］を押すと、回数券の一覧を下から出す（ui/ticketSheet.ts）
 */

import { TRIAL_GENERATIONS } from '@/config/tickets';
import { remainingGenerations, walletState } from '@/core/wallet';
import { authState } from '@/platform/auth';
import { createIcon } from '@/ui/icons';

export interface WalletBarOptions {
  /** ［ログイン］を押したとき */
  onLogin(): void;
  /** ［購入］を押したとき */
  onBuy(): void;
}

export function createWalletBar({ onLogin, onBuy }: WalletBarOptions): { element: HTMLElement; render(): void } {
  const element = document.createElement('div');
  element.className = 'wallet-bar';

  // 左: 立方体の印・「3D 作成」・「残り」・回数・「回」（回数を数えない設定なら「回数無制限」）
  const count = document.createElement('div');
  count.className = 'wallet-bar__count';
  const mark = document.createElement('span');
  mark.className = 'wallet-bar__mark';
  mark.append(createIcon('cube'));
  const label = document.createElement('span');
  label.className = 'wallet-bar__unit';
  label.textContent = '3D 作成';
  const remainingLabel = document.createElement('span');
  remainingLabel.className = 'wallet-bar__unit';
  remainingLabel.textContent = '残り';
  const number = document.createElement('span');
  number.className = 'wallet-bar__number';
  const unit = document.createElement('span');
  unit.className = 'wallet-bar__unit';
  unit.textContent = '回';
  const unlimited = document.createElement('span');
  unlimited.className = 'wallet-bar__unit';
  unlimited.textContent = '回数無制限';
  count.append(mark, label, remainingLabel, number, unit, unlimited);

  // 右: ログインしていれば［購入］、していなければ［ログイン］
  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'wallet-bar__buy';
  buy.textContent = '購入';
  buy.addEventListener('click', onBuy);
  const login = document.createElement('button');
  login.type = 'button';
  login.className = 'button is-small wallet-bar__login';
  login.textContent = 'ログイン';
  login.addEventListener('click', onLogin);

  element.append(count, buy, login);

  /** 回数を出すか「回数無制限」を出すか */
  function showCount(remaining: number | null): void {
    const counted = remaining !== null;
    for (const part of [remainingLabel, number, unit]) part.hidden = !counted;
    unlimited.hidden = counted;
    number.textContent = String(remaining ?? '');
  }

  function render(): void {
    const auth = authState.get();
    const wallet = walletState.get();
    // 認証できないときは、画面の別の所で理由を出している
    if (auth.status !== 'ready') {
      element.hidden = true;
      return;
    }
    if (auth.anonymous) {
      // ログインするとお試しの回数ぶん作れる。財布はログインしてからしか読めないので、決まった数で出す
      element.hidden = false;
      showCount(TRIAL_GENERATIONS);
      buy.hidden = true;
      login.hidden = false;
      return;
    }
    // 回数がまだ分からない（読み込み中・読めなかった）間は、帯ごと出さない
    if (wallet.status !== 'ready') {
      element.hidden = true;
      return;
    }
    element.hidden = false;
    login.hidden = true;
    // 回数を数えない設定のアカウントは remainingGenerations が null（core/wallet.ts）
    const remaining = remainingGenerations(wallet);
    showCount(remaining);
    buy.hidden = remaining === null;
  }

  authState.subscribe(render);
  walletState.subscribe(render);
  render();
  return { element, render };
}
