/**
 * ログインを求める小さなパネル。「3Dモデル」タブの作成ボタンの場所に出す。
 *
 * 写真を選んだあと、匿名のままなら作成の代わりにこれを出す。
 * **選んだ写真は持ったまま**にして、ログインできたらそのまま作成に進む。
 * ログインのために写真を選び直させない。
 *
 * ポップアップは直接のクリックからしか開けないので、ここの「Google でログイン」の
 * クリックの中で signInWithGoogle() を呼ぶ。await を挟んだ先で開こうとすると塞がれる。
 */

import { signInWithGoogle } from '@/platform/auth';

export interface LoginPanel {
  element: HTMLElement;
  /** 写真を預かって出す */
  open(files: File[]): void;
  close(): void;
}

export function createLoginPanel(onSignedIn: (files: File[]) => void): LoginPanel {
  const element = document.createElement('div');
  element.className = 'login';
  element.hidden = true;

  const title = document.createElement('p');
  title.className = 'login__title';
  title.textContent = '3Dモデルの作成には Google ログインが必要です';

  const note = document.createElement('p');
  note.className = 'hint login__note';
  note.textContent = 'ログインすると、選んだ写真でそのまま作成が始まります';

  const buttons = document.createElement('div');
  buttons.className = 'row';
  const loginButton = createButton('Google でログイン', 'button', () => void login());
  const cancelButton = createButton('やめる', 'button is-quiet', () => close());
  buttons.append(loginButton, cancelButton);

  const error = document.createElement('p');
  error.className = 'hint is-error';
  error.hidden = true;

  element.append(title, note, buttons, error);

  /** 預かっている写真。閉じたら捨てる */
  let pending: File[] = [];

  async function login(): Promise<void> {
    loginButton.disabled = true;
    loginButton.textContent = 'ログインしています…';
    error.hidden = true;
    try {
      const outcome = await signInWithGoogle();
      if (outcome === 'signed-in') {
        const files = pending;
        close();
        onSignedIn(files);
        return;
      }
      // 閉じられただけ。写真は持ったまま、もう一度押せるようにする
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : 'ログインできませんでした';
      error.hidden = false;
    }
    loginButton.disabled = false;
    loginButton.textContent = 'Google でログイン';
  }

  function open(files: File[]): void {
    pending = files;
    error.hidden = true;
    element.hidden = false;
  }

  function close(): void {
    pending = [];
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
