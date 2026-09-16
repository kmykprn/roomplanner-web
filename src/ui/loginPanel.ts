/**
 * ログインを求める小さなパネル。「家具」タブの作成ボタンの場所に出す。
 *
 * 匿名のまま「作る」のどの作り方を押しても、**写真を選ぶ前に**これを出す。
 * ログインできたら閉じ、利用者はもう一度ボタンを押して写真を選ぶ。
 *
 * 以前は写真を選んだあとにログインを求め、選んだ写真を持ったまま作成に進んでいた。
 * iOS ではログインがリダイレクト（ページの読み直し）になり写真を持ち越せないため、
 * 順序を入れ替えた。ログイン後に自動で写真選択を開かないのは、ポップアップやリダイレクトを
 * 挟んだあとではブラウザが「利用者の操作」とみなさず、ファイル選択を塞ぐことがあるため。
 *
 * ポップアップは直接のクリックからしか開けないので、ここの「Google でログイン」の
 * クリックの中で signInWithGoogle() を呼ぶ。await を挟んだ先で開こうとすると塞がれる。
 *
 * ログインの Promise が決着しないまま止まる事故が実際にあった（iOS Safari）。
 * 二度と無言で止まらないよう、待つ時間に上限を置く。
 */

import { signInWithApple, signInWithGoogle, usesRedirectLogin } from '@/platform/auth';
import { isNativeApp } from '@/platform/native';

/**
 * ログインの応答を待つ上限。Google の画面で利用者がアカウントを選ぶ時間を含むので短くしない。
 * iOS ではこの間にページごと Google へ遷移するので、ここで切れるのは遷移が起きなかったとき
 */
const LOGIN_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('ログインが完了しませんでした。もう一度お試しください')),
      ms
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export interface LoginPanel {
  element: HTMLElement;
  open(): void;
  close(): void;
}

/** onSignedIn はポップアップでログインできた直後に呼ぶ（iOS のリダイレクトでは呼ばれない） */
export function createLoginPanel(onSignedIn: () => void): LoginPanel {
  const element = document.createElement('div');
  element.className = 'login';
  element.hidden = true;

  const title = document.createElement('p');
  title.className = 'login__title';
  // iOS アプリでは Apple でも入れる（Google を出す以上、App Store の審査で必須）
  title.textContent = isNativeApp ? '家具を作るにはログインが必要です' : '家具を作るには Google ログインが必要です';

  const note = document.createElement('p');
  note.className = 'hint login__note';
  note.textContent = 'ログイン後に、写真を選んで作れます';

  const buttons = document.createElement('div');
  buttons.className = 'row';
  const loginButton = createButton('Google でログイン', 'button', () => void login(loginButton, signInWithGoogle));
  const appleButton = createButton('Apple でログイン', 'button', () => void login(appleButton, signInWithApple));
  appleButton.hidden = !isNativeApp;
  const cancelButton = createButton('やめる', 'button is-quiet', () => close());
  buttons.append(loginButton, appleButton, cancelButton);

  const error = document.createElement('p');
  error.className = 'hint is-error';
  error.hidden = true;

  element.append(title, note, buttons, error);

  async function login(button: HTMLButtonElement, signIn: () => Promise<'signed-in' | 'cancelled'>): Promise<void> {
    const label = button.textContent;
    loginButton.disabled = appleButton.disabled = true;
    button.textContent = usesRedirectLogin() ? 'Google へ移動しています…' : 'ログインしています…';
    error.hidden = true;
    try {
      const outcome = await withTimeout(signIn(), LOGIN_TIMEOUT_MS);
      if (outcome === 'signed-in') {
        close();
        onSignedIn();
        return;
      }
      // 閉じられただけ。もう一度押せるようにする
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : 'ログインできませんでした';
      error.hidden = false;
    }
    loginButton.disabled = appleButton.disabled = false;
    button.textContent = label;
  }

  function open(): void {
    error.hidden = true;
    element.hidden = false;
  }

  function close(): void {
    element.hidden = true;
  }

  return { element, open, close };
}

function createButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}
