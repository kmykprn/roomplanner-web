/**
 * 写真モードの「手前」タブ。
 *
 * 写真の中で家具より手前にある物（机など）を指定してもらう。指定した部分は
 * 写真が家具の上にかぶさるので、後ろへ動かした家具が隠れる。
 *
 *   1 行目 … 見出し（何のためのタブか）
 *   2 行目 … 道具の切り替えと、どの道具でも使う「戻す」「全部消す」
 *   3 行目 … 道具ごとの設定（高さは固定。入れ替わっても写真が伸び縮みしない）
 *   4 行目 … いま何をすればよいかの案内。囲むは打った角の数で変わる
 *
 * 指の操作は interaction/maskPaint.ts、形を描く中身は core/maskEditor.ts。
 */

import { maskEditor } from '@/core/maskEditor';
import { clearMask, photoState, setMaskTool, type MaskToolKind } from '@/core/photoState';

const HEADLINE = '背景の中で、家具より手前にしたいエリアを選んでください';
const NO_PHOTO = '先に「背景」タブで写真を選んでください';

const TOOLS: Array<[MaskToolKind, string]> = [
  ['brush', 'なぞる'],
  ['polygon', '囲む'],
  ['eraser', '消しゴム'],
];

/** 囲みを閉じるのに要る角の数 */
const MIN_CORNERS = 3;

export function createMaskPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'mask';

  const headline = document.createElement('p');
  headline.className = 'hint';

  // 2 行目
  const toolbar = document.createElement('div');
  toolbar.className = 'mask__toolbar';
  const toolSwitch = createSegment(
    TOOLS.map(([kind, label]) => [label, () => setMaskTool({ kind })])
  );
  const undoButton = createButton('戻す', () => maskEditor.undo(), 'button is-quiet is-small');
  const clearButton = createButton('全部消す', clearMask, 'button is-quiet is-small');
  toolbar.append(toolSwitch.element, undoButton, clearButton);

  // 3 行目
  const row = document.createElement('div');
  row.className = 'mask__row';
  const widthSwitch = createSegment([
    ['細い', () => setMaskTool({ thick: false })],
    ['太い', () => setMaskTool({ thick: true })],
  ]);
  const closeButton = createButton(
    '囲みを閉じる',
    () => maskEditor.closePolygon(),
    'button is-small'
  );
  row.append(widthSwitch.element, closeButton);

  // 4 行目
  const guide = document.createElement('p');
  guide.className = 'hint';

  panel.append(headline, toolbar, row, guide);

  function render(): void {
    const { backgroundStatus, maskTool, maskUrl, maskPolygon, maskUndoDepth } = photoState.get();
    const hasPhoto = backgroundStatus === 'ready';
    const { kind } = maskTool;

    headline.textContent = hasPhoto ? HEADLINE : NO_PHOTO;

    toolSwitch.setActive(TOOLS.findIndex(([id]) => id === kind));
    toolSwitch.setEnabled(hasPhoto);
    undoButton.disabled = !hasPhoto || (maskUndoDepth === 0 && maskPolygon.length === 0);
    clearButton.disabled = !hasPhoto || !maskUrl;

    // 道具ごとに要るものだけ出す
    widthSwitch.element.hidden = kind === 'polygon';
    widthSwitch.setActive(maskTool.thick ? 1 : 0);
    widthSwitch.setEnabled(hasPhoto);
    closeButton.hidden = kind !== 'polygon';
    closeButton.disabled = maskPolygon.length < MIN_CORNERS;

    guide.textContent = hasPhoto ? describe(kind, maskPolygon.length) : '';
    guide.hidden = !hasPhoto;
  }

  render();
  photoState.subscribe(render);
  return panel;
}

/** いま何をすればよいか。囲むは、打った角の数で次の一手が変わる */
function describe(kind: MaskToolKind, corners: number): string {
  switch (kind) {
    case 'brush':
      return '机など、手前にある物の上をなぞってください';
    case 'eraser':
      return 'はみ出した部分をなぞって消します';
    case 'polygon':
      if (corners === 0)
        return `物の角を順にタップしていきます（${MIN_CORNERS}つ以上で閉じられます）`;
      if (corners < MIN_CORNERS)
        return `次の角をタップ（あと ${MIN_CORNERS - corners} つで閉じられます）`;
      return '角を続けるか、「囲みを閉じる」か最初の角をもう一度タップで中を塗ります';
  }
}

function createButton(label: string, onClick: () => void, className: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

/** いくつかから 1 つ選ぶ切り替え。どれが選ばれているかは状態から描く */
function createSegment(items: Array<[label: string, select: () => void]>): {
  element: HTMLElement;
  setActive(index: number): void;
  setEnabled(enabled: boolean): void;
} {
  const element = document.createElement('div');
  element.className = 'seg';
  const buttons = items.map(([label, select]) => {
    const button = document.createElement('button');
    button.className = 'seg__item';
    button.textContent = label;
    button.addEventListener('click', select);
    element.appendChild(button);
    return button;
  });
  return {
    element,
    setActive: (index) => buttons.forEach((b, i) => b.classList.toggle('is-active', i === index)),
    setEnabled: (enabled) => buttons.forEach((b) => (b.disabled = !enabled)),
  };
}
