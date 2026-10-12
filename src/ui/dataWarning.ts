/**
 * 3D モデルを作り始める直前の確認。Wi-Fi 接続をすすめる（通信量を多く使うため）。
 * 「今後このメッセージを見せない」にチェックを付けて作成すると端末に覚え、以後は出さずに true を返す。
 * 文言は YouTube の「Wi-Fi 接続時のみ」の言い方に寄せ、具体的なサイズは出さない
 */

const SKIP_KEY = 'roomplanner.generation.skipDataWarning';

/** 確認を出す。作成してよければ true、キャンセルなら false。覚えていれば出さずに true */
export function confirmDataUsage(): Promise<boolean> {
  if (isSkipped()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', '3D モデルの作成の確認');
    const box = document.createElement('div');
    box.className = 'modal__box';
    const title = document.createElement('p');
    title.className = 'modal__title';
    title.textContent = '3D モデルの作成は Wi-Fi 接続時がおすすめです';
    const body = document.createElement('p');
    body.className = 'modal__text';
    body.textContent = 'モバイルデータ通信でも作成できますが、通信量を多く使います。';
    const skipRow = document.createElement('label');
    skipRow.className = 'modal__check';
    const skip = document.createElement('input');
    skip.type = 'checkbox';
    skipRow.append(skip, Object.assign(document.createElement('span'), { textContent: '今後このメッセージを見せない' }));
    const buttons = document.createElement('div');
    buttons.className = 'confirm__buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button is-quiet is-small';
    cancel.textContent = 'キャンセル';
    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'button is-small';
    start.textContent = '作成する';
    buttons.append(cancel, start);
    box.append(title, body, skipRow, buttons);
    modal.append(box);

    const finish = (value: boolean): void => {
      modal.remove();
      resolve(value);
    };
    cancel.addEventListener('click', () => finish(false));
    start.addEventListener('click', () => {
      if (skip.checked) remember();
      finish(true);
    });
    document.body.append(modal);
  });
}

function isSkipped(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(SKIP_KEY, '1');
  } catch {
    // 覚えられなければ次も出る
  }
}
