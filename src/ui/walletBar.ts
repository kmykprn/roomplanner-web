/**
 * 「家具を追加」の画面のいちばん上に出す、3D を作れる残りの回数の帯。
 *
 *   ログインしている       … 「3D 3 回」を大きく出し、下の行に内訳（お試し・回数券）
 *                             回数を数えない設定のアカウント（開発者）は「回数を数えない設定です」
 *   ログインしていない     … 「ログインすると、家具を作れます。」「3D はお試しで 3 回作れます。」と［ログイン］
 *
 * ［回数券を買う］は、買う画面ができるまで出さない（押しても何も起きないボタンは出さない）。
 * 買う画面を作ったら、onBuy を渡せばアプリ版でだけ出る。Web では App Store で買えないので出さない。
 * Web で残りが 0 回のときだけ、「回数券はアプリ版で買えます」と出す
 */

import { remainingGenerations, walletState } from '@/core/wallet';
import { authState } from '@/platform/auth';
import { isNativeApp } from '@/platform/native';
import { createIcon } from '@/ui/icons';

export interface WalletBarOptions {
  /** ［ログイン］を押したとき */
  onLogin(): void;
  /** ［回数券を買う］を押したとき。渡さなければボタンを出さない（買う画面ができるまで） */
  onBuy?: () => void;
}

export function createWalletBar({ onLogin, onBuy }: WalletBarOptions): { element: HTMLElement; render(): void } {
  const element = document.createElement('div');
  element.className = 'wallet-bar';

  // ログインしているときの行: 立方体の印・「3D」・回数・「回」と、右に［回数券を買う］
  const signedIn = document.createElement('div');
  signedIn.className = 'wallet-bar__main';
  const count = document.createElement('div');
  count.className = 'wallet-bar__count';
  const mark = document.createElement('span');
  mark.className = 'wallet-bar__mark';
  mark.append(createIcon('cube'));
  const kind = document.createElement('span');
  kind.className = 'wallet-bar__unit';
  kind.textContent = '3D';
  const number = document.createElement('span');
  number.className = 'wallet-bar__number';
  const unit = document.createElement('span');
  unit.className = 'wallet-bar__unit';
  unit.textContent = '回';
  const unmetered = document.createElement('span');
  unmetered.className = 'wallet-bar__unmetered';
  unmetered.textContent = '回数を数えない設定です';
  count.append(mark, kind, number, unit, unmetered);
  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'wallet-bar__buy';
  buy.textContent = '回数券を買う';
  if (onBuy) buy.addEventListener('click', onBuy);
  signedIn.append(count, buy);

  const detail = document.createElement('p');
  detail.className = 'wallet-bar__detail';
  const storeNote = document.createElement('p');
  storeNote.className = 'wallet-bar__note';
  storeNote.textContent = '回数券はアプリ版で買えます';

  // ログインしていないときの行
  const anonymous = document.createElement('div');
  anonymous.className = 'wallet-bar__main';
  const anonymousText = document.createElement('p');
  anonymousText.className = 'wallet-bar__login-text';
  const anonymousLead = document.createElement('span');
  anonymousLead.textContent = 'ログインすると、家具を作れます。';
  const anonymousTrial = document.createElement('span');
  // お試しの回数はサーバーの TRIAL_COUNT（既定 3）。財布はログインしてからしか読めないので、ここは決まった数で書く
  anonymousTrial.textContent = '3D はお試しで 3 回作れます。';
  anonymousText.append(anonymousLead, anonymousTrial);
  const login = document.createElement('button');
  login.type = 'button';
  login.className = 'button is-small wallet-bar__login';
  login.textContent = 'ログイン';
  login.addEventListener('click', onLogin);
  anonymous.append(anonymousText, login);

  element.append(signedIn, detail, storeNote, anonymous);

  function render(): void {
    const auth = authState.get();
    const wallet = walletState.get();
    // 認証できないときは、画面の別の所で理由を出している
    if (auth.status !== 'ready') {
      element.hidden = true;
      return;
    }
    element.hidden = false;
    anonymous.hidden = !auth.anonymous;
    const showWallet = !auth.anonymous && wallet.status === 'ready';
    signedIn.hidden = !showWallet;
    detail.hidden = !showWallet || Boolean(wallet.unmetered);
    storeNote.hidden = true;
    // 回数がまだ分からない（読み込み中・読めなかった）間は、帯ごと出さない（ログインしていないときを除く）
    if (!auth.anonymous && !showWallet) {
      element.hidden = true;
      return;
    }
    if (!showWallet) return;

    const remaining = remainingGenerations(wallet);
    const counted = !wallet.unmetered;
    number.hidden = !counted;
    unit.hidden = !counted;
    kind.hidden = !counted;
    unmetered.hidden = counted;
    number.textContent = String(remaining ?? 0);
    detail.textContent = `お試し ${wallet.trialRemaining} 回　回数券 ${wallet.credits} 回`;
    buy.hidden = !(onBuy && isNativeApp && counted);
    storeNote.hidden = !(counted && !isNativeApp && remaining === 0);
  }

  authState.subscribe(render);
  walletState.subscribe(render);
  render();
  return { element, render };
}
