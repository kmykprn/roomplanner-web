/**
 * ログインを求める小さなパネル。「家具」タブの作成ボタンの場所に出す。
 *
 * 匿名のまま「＋ 写真から家具を作る」を押したら、**写真を選ぶ前に**これを出す。
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

import { signInWithGoogle, usesRedirectLogin } from '@/platform/auth';

/**
 * ログインの応答を待つ上限。Google の画面で利用者がアカウントを選ぶ時間を含むので短くしない。
 * iOS ではこの間にページごと Google へ遷移するので、ここで切れるのは遷移が起きなかったとき
 */
const LOGIN_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('ログインの応答がありません。もう一度お試しください')),
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
  title.textContent = '家具の作成には Google ログインが必要です';

  const note = document.createElement('p');
  note.className = 'hint login__note';
  note.textContent = 'ログインすると、写真を選んで作成できるようになります';

  const buttons = document.createElement('div');
  buttons.className = 'row';
  const loginButton = createButton('Google でログイン', 'button', () => void login());
  const cancelButton = createButton('やめる', 'button is-quiet', () => close());
  buttons.append(loginButton, cancelButton);

  const error = document.createElement('p');
  error.className = 'hint is-error';
  error.hidden = true;

  element.append(title, note, buttons, error);

  async function login(): Promise<void> {
    loginButton.disabled = true;
    loginButton.textContent = usesRedirectLogin() ? 'Google へ移動しています…' : 'ログインしています…';
    error.hidden = true;
    try {
      const outcome = await withTimeout(signInWithGoogle(), LOGIN_TIMEOUT_MS);
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
    loginButton.disabled = false;
    loginButton.textContent = 'Google でログイン';
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
