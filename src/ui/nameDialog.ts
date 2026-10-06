/**
 * 「名前を変える」の欄。今の名前が入った欄と「キャンセル」「決定」。
 * 一覧のタイルの ⋯ からも、編集の画面の名前からも同じものを出す。
 * 決定なら新しい名前（前後の空白を除く）、キャンセルか空のままなら null
 */

export function askName(current: string): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', '名前を変える');
    const box = document.createElement('form');
    box.className = 'modal__box';
    const title = document.createElement('p');
    title.className = 'modal__title';
    title.textContent = '名前を変える';
    const input = document.createElement('input');
    input.className = 'name-dialog__input';
    input.type = 'text';
    input.value = current;
    input.maxLength = 40;
    input.setAttribute('aria-label', '名前');
    const buttons = document.createElement('div');
    buttons.className = 'confirm__buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button is-quiet is-small';
    cancel.textContent = 'キャンセル';
    const decide = document.createElement('button');
    decide.type = 'submit';
    decide.className = 'button is-small';
    decide.textContent = '決定';
    buttons.append(cancel, decide);
    box.append(title, input, buttons);
    modal.append(box);

    const finish = (value: string | null): void => {
      modal.remove();
      resolve(value);
    };
    cancel.addEventListener('click', () => finish(null));
    box.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input.value.trim();
      finish(value ? value : null);
    });
    document.body.append(modal);
    input.focus();
    input.select();
  });
}
