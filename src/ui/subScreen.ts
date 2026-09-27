/**
 * 「背景の調整」の各画面（拡大・縮小／寸法／家具より手前に表示する範囲）に共通の枠。
 *
 *   上の段 … 左に「‹ 戻る」、真ん中に見出し（help があれば見出しの右に ?。押すと help の文を吹き出しで出す）
 *   中身   … 画面ごとの説明と部品（body に入れる）
 *   下の段 … 左にその画面でだけ使うボタン（actions に入れる）、右に「保存」
 *
 * 「戻る」は、この画面で変えたことを取り消して戻る。「保存」は変えたことを残して戻る。
 * 取り消し方は画面ごとに違うので、呼ぶ側が onBack で行う。
 */

export interface SubScreen {
  element: HTMLElement;
  /** 説明と部品を入れる所 */
  body: HTMLElement;
  /** 下の段の左に並べるボタンを入れる所 */
  actions: HTMLElement;
  /** 「‹ 戻る」と「保存」。押せなくしたり目立たせたりしたい画面が触る */
  back: HTMLButtonElement;
  done: HTMLButtonElement;
}

export function createSubScreen(options: { title: string; help?: string; onBack(): void; onDone(): void }): SubScreen {
  const element = document.createElement('div');
  element.className = 'sub';

  const head = document.createElement('div');
  head.className = 'edit__head sub__head';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'button is-text is-small';
  back.textContent = '‹ 戻る';
  back.addEventListener('click', options.onBack);
  const title = document.createElement('span');
  title.className = 'edit__title';
  title.textContent = options.title;
  const spacer = document.createElement('span');
  spacer.className = 'edit__spacer';
  head.append(back, title, spacer);
  if (options.help) title.append(createHelp(options.help, head));

  const body = document.createElement('div');
  body.className = 'sub__body';

  const foot = document.createElement('div');
  foot.className = 'sub__foot';
  const actions = document.createElement('div');
  actions.className = 'sub__actions';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'button sub__done';
  done.textContent = '保存';
  done.addEventListener('click', options.onDone);
  foot.append(actions, done);

  element.append(head, body, foot);
  return { element, body, actions, back, done };
}

/**
 * 見出しの右の ?。押すと、画面の目的の文を見出しの下に吹き出しで出す。
 * もう一度押すか、ほかの場所を押すと閉じる。ふだん読まなくてよい文を、画面から外しておくためのもの
 */
function createHelp(text: string, head: HTMLElement): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sub__help';
  button.textContent = '?';
  button.setAttribute('aria-label', '説明を表示');
  button.setAttribute('aria-expanded', 'false');

  const tip = document.createElement('p');
  tip.className = 'sub__tip';
  tip.setAttribute('role', 'tooltip');
  tip.textContent = text;
  tip.hidden = true;
  head.append(tip);

  const setOpen = (open: boolean): void => {
    tip.hidden = !open;
    button.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(tip.hidden);
  });
  document.addEventListener('click', () => setOpen(false));
  return button;
}

/** 説明の文を 1 文ずつ段落にして並べる（1 文 1 メッセージ） */
export function createSentences(sentences: string[], className = 'sub__text'): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'sub__sentences';
  for (const sentence of sentences) {
    const p = document.createElement('p');
    p.className = className;
    p.textContent = sentence;
    wrap.append(p);
  }
  return wrap;
}

/** 下の段の左に置く、控えめなボタン */
export function createQuietButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button is-quiet is-small';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}
