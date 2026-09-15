/**
 * 商品ページの URL を貼る欄。「作り方を選ぶ」で「商品の URL から」を押したときだけ出す。
 *
 * 楽天市場の商品ページの URL を貼って「取り込む」を押すと、閉じて取り込みが始まる。
 * 進み具合は一覧のサムネイル（切り抜きと同じ円）に出るので、ここでは何も待たない。
 */

export interface ProductForm {
  element: HTMLElement;
  open(): void;
  close(): void;
}

export function createProductForm(onSubmit: (url: string) => void): ProductForm {
  const element = document.createElement('form');
  element.className = 'product-form';
  element.hidden = true;

  const label = document.createElement('label');
  label.className = 'field__label';
  label.htmlFor = 'product-url';
  label.textContent = '楽天市場の商品ページの URL';

  const input = document.createElement('input');
  input.type = 'url';
  input.id = 'product-url';
  input.className = 'field__input';
  input.placeholder = 'https://item.rakuten.co.jp/…';
  input.autocomplete = 'off';
  input.required = true;

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = '商品の画像を切り抜いて、寸法が分かれば実寸で置けます';

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

  element.append(label, input, hint, error, buttons);

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
    input.focus();
  }

  function close(): void {
    element.hidden = true;
  }

  return { element, open, close };
}
