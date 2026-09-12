/**
 * 「背景」タブの中の、手前の範囲を指定する姿。
 *
 * 写真の中で 3D モデルより手前にある物（机など）を指定してもらう。指定した部分は
 * 写真がモデルの上にかぶさるので、後ろへ動かしたモデルが隠れる。
 * 「完了」で背景タブの通常の姿に戻る。
 *
 *   1 行目 … 見出し（何のためのタブか）
 *   2 行目 … 道具の切り替えと、どの道具でも使う「戻す」「全部消す」
 *   3 行目 … 道具ごとの設定（高さは固定。入れ替わっても写真が伸び縮みしない）。
 *            囲むは「囲みを閉じる」ボタンの文字で、打った角の数と閉じられるかを伝える
 *
 * 指の操作は interaction/maskPaint.ts、形を描く中身は core/maskEditor.ts。
 */

import { maskEditor } from '@/core/maskEditor';
import {
  clearMask,
  photoState,
  setMasking,
  setMaskTool,
  type MaskToolKind,
} from '@/core/photoState';

const HEADLINE = '背景の中で3Dモデルより手前に表示したいエリアを指定して下さい';
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
  // 「完了」は右端。指定を終えて背景タブの通常の姿に戻る
  const spacer = document.createElement('span');
  spacer.className = 'mask__spacer';
  const doneButton = createButton('完了', () => setMasking(false), 'button is-small');
  row.append(widthSwitch.element, closeButton, spacer, doneButton);

  panel.append(headline, toolbar, row);

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
    closeButton.textContent = closeLabel(maskPolygon.length);
  }

  render();
  photoState.subscribe(render);
  return panel;
}

/**
 * 「囲みを閉じる」の文字。打った角の数と、閉じられるかをボタン自身で伝える。
 * 足りない間は「あと N 点」、そろったら「囲みを閉じる（N点）」
 */
function closeLabel(corners: number): string {
  if (corners < MIN_CORNERS) return `あと ${MIN_CORNERS - corners} 点タップで閉じられます`;
  return `囲みを閉じる（${corners}点）`;
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
