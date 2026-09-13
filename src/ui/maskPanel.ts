/**
 * 「背景」タブの中の、手前の範囲を指定する姿。
 *
 * 写真の中で 3D モデルより手前にある物（机など）を指定してもらう。指定した部分は
 * 写真がモデルの上にかぶさるので、後ろへ動かしたモデルが隠れる。
 * 「完了」で背景タブの通常の姿に戻る。
 *
 *   1 行目 … 案内。**今なにをすればいいか**を、道具と進み具合に合わせて 1 文で出す。
 *            「なぜ」は背景タブの行の下（ui/photoPanel.ts）に任せ、ここは「どうするか」だけ
 *   2 行目 … 道具の切り替えと、どの道具でも使う「戻す」「全部消す」。
 *            道具の名前は動作で書く（「点をつないで囲む」）。「角」は伝わらなかった
 *   3 行目 … 道具ごとの設定（高さは固定。入れ替わっても写真が伸び縮みしない）
 *
 * 指の操作は interaction/maskPaint.ts、形を描く中身は core/maskEditor.ts。
 */

import { MIN_CORNERS, maskEditor } from '@/core/maskEditor';
import {
  clearMask,
  photoState,
  setMasking,
  setMaskTool,
  type MaskToolKind,
} from '@/core/photoState';

const NO_PHOTO = '先に「背景」タブで写真を選んでください';

const TOOLS: Array<[MaskToolKind, string]> = [
  ['brush', '指でなぞる'],
  ['polygon', '点をつないで囲む'],
  ['eraser', '消しゴム'],
];

/**
 * 今なにをすればいいかの 1 文。done は「もう次に進める」状態（案内の色を変える）。
 *
 * 目的の文（「手前に表示したいエリアを…」）だけでは、指でなぞるのか点を打つのかが
 * 分からず、押してみて初めて分かる状態だった。道具と進み具合ごとに動作を書く
 */
function guideFor(kind: MaskToolKind, corners: number, painted: boolean): { text: string; done: boolean } {
  switch (kind) {
    case 'brush':
      return painted
        ? { text: 'はみ出した部分を消すなら「消しゴム」、やり直すなら「戻す」を押して下さい', done: true }
        : { text: '写真の上を指でなぞると、なぞった部分が3Dモデルの手前になります', done: false };
    case 'eraser':
      return { text: '消したい部分を指でなぞると、手前の指定が消えます', done: false };
    case 'polygon':
      if (corners === 0) {
        return {
          text: `囲みたい物のふちに沿って、点をつなぐようにタップしてください（${MIN_CORNERS}点以上）`,
          done: false,
        };
      }
      if (corners < MIN_CORNERS) {
        return { text: `あと ${MIN_CORNERS - corners} 点。物のふちに沿ってタップしてください`, done: false };
      }
      return {
        text: '最初の点をもう一度タップするか「囲みを閉じる」で、囲んだ中が3Dモデルの手前になります',
        done: true,
      };
  }
}

export function createMaskPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'mask';

  const guide = document.createElement('p');

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

  panel.append(guide, toolbar, row);

  function render(): void {
    const { backgroundStatus, maskTool, maskUrl, maskPolygon, maskUndoDepth } = photoState.get();
    const hasPhoto = backgroundStatus === 'ready';
    const { kind } = maskTool;

    if (hasPhoto) {
      const { text, done } = guideFor(kind, maskPolygon.length, maskUrl !== null);
      guide.className = done ? 'mask__guide is-done' : 'mask__guide';
      guide.textContent = text;
    } else {
      guide.className = 'hint';
      guide.textContent = NO_PHOTO;
    }

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

/** 「囲みを閉じる」の文字。進み具合は案内の行が言うので、ここは点の数だけ */
function closeLabel(corners: number): string {
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
