/**
 * 商品ページの URL を貼る欄。「作り方を選ぶ」の「商品の URL から」の行の中で開く。
 *
 * 楽天市場の商品ページの URL を貼って「取り込む」を押すと、閉じて取り込みが始まる。
 * 進み具合は一覧のサムネイル（切り抜きと同じ円）に出るので、ここでは何も待たない。
 * 行の見出しに説明があるので、ここには欄とボタンだけを置く。
 */

export interface ProductForm {
  element: HTMLElement;
  open(): void;
  close(): void;
}

export interface ProductFormOptions {
  onSubmit(url: string): void;
  /** 開いた・閉じたを伝える。行の見た目を合わせるため */
  onToggle?(opened: boolean): void;
}

export function createProductForm({ onSubmit, onToggle }: ProductFormOptions): ProductForm {
  const element = document.createElement('form');
  element.className = 'product-form';
  element.hidden = true;

  const input = document.createElement('input');
  input.type = 'url';
  input.id = 'product-url';
  input.className = 'field__input';
  input.placeholder = '楽天市場の商品ページの URL';
  input.setAttribute('aria-label', '楽天市場の商品ページの URL');
  input.autocomplete = 'off';
  input.required = true;

  const error = document.createElement('p');
  error.className = 'hint is-error';
  error.hidden = true;

  const buttons = document.createElement('div');
  buttons.className = 'row';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'button is-small';
  submit.textContent = '取り込む';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'button is-quiet is-small';
  cancel.textContent = 'やめる';
  cancel.addEventListener('click', close);
  buttons.append(submit, cancel);

  element.append(input, error, buttons);

  element.addEventListener('submit', (event) => {
    event.preventDefault();
    const url = input.value.trim();
    if (!/^https?:\/\/item\.rakuten\.co\.jp\//i.test(url)) {
      error.textContent = '楽天市場の商品ページ（item.rakuten.co.jp/…）の URL を貼ってください';
      error.hidden = false;
      return;
    }
    close();
    onSubmit(url);
  });

  function open(): void {
    error.hidden = true;
    input.value = '';
    element.hidden = false;
    onToggle?.(true);
    input.focus();
    // iOS はキーボードが出るとシートが縮む。欄が隠れないように見える位置へ
    input.scrollIntoView({ block: 'nearest' });
  }

  function close(): void {
    element.hidden = true;
    onToggle?.(false);
  }

  return { element, open, close };
}
