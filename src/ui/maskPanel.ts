/**
 * 「背景」タブの中の、手前の範囲を指定する姿。
 *
 * 写真の中で家具より手前にある物（机など）を指定してもらう。指定した部分は
 * 写真がモデルの上にかぶさるので、後ろへ動かしたモデルが隠れる。
 * 「完了」で背景タブの通常の姿に戻る。
 *
 *   1 行目 … 題「手前の範囲」と「完了」。完了は「この画面を出る」操作なので、道具や設定と
 *            同じ段に混ぜず、iOS の画面右上と同じ位置に置く。文字だけだとタブ名の青と
 *            見分けにくかったので、塗りつぶしの青にチェックを添える
 *   2 行目 … 案内。**今なにをすればいいか**を、道具と進み具合に合わせて 1 文で出す。
 *            「なぜ」は背景タブの行の下（ui/photoPanel.ts）に任せ、ここは「どうするか」だけ
 *   3 行目 … 道具の切り替えだけ。名前は動作で書く（「点をつないで囲む」）。「角」は伝わらなかった
 *   4 行目 … 道具ごとの設定（細い/太い、囲みを閉じる）と、どの道具でも使う「戻す」「全部消す」。
 *            戻す・全部消すは 1 つの組にして、どの道具でも同じ場所に出す。
 *            高さは固定（入れ替わっても写真が伸び縮みしない）
 *
 * 指の操作は interaction/maskPaint.ts、形を描く中身は core/maskEditor.ts。
 */

import { MIN_CORNERS, maskEditor } from '@/core/maskEditor';
import { createIcon } from '@/ui/icons';
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
 * 今なにをすればいいかの 1 文。done は「押すべきものが現れた」状態で、案内の色を緑にする。
 *
 * 目的の文（「手前に表示したいエリアを…」）だけでは、指でなぞるのか点を打つのかが
 * 分からず、押してみて初めて分かる状態だった。道具と進み具合ごとに動作を書く。
 *
 * 緑になるのは囲むの 3 点以上だけ。なぞるは塗り続けるだけで「次に押すもの」が無いので、
 * 塗った後も文と色を変えない（一筆で緑になって以後ずっと緑、が気持ち悪かった）
 */
function guideFor(kind: MaskToolKind, corners: number): { text: string; done: boolean } {
  switch (kind) {
    case 'brush':
      return { text: '写真の上を指でなぞると、なぞった部分が家具の手前になります', done: false };
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
        text: '最初の点をもう一度タップするか「囲みを閉じる」で、囲んだ中が家具の手前になります',
        done: true,
      };
  }
}

export function createMaskPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'mask';

  // 1 行目。「完了」は指定を終えて背景タブの通常の姿に戻る
  const head = document.createElement('div');
  head.className = 'mask__head';
  const title = document.createElement('span');
  title.className = 'mask__title';
  title.textContent = '手前の範囲';
  const doneButton = createButton('完了', () => setMasking(false), 'button is-small mask__done');
  doneButton.prepend(createIcon('check'));
  head.append(title, doneButton);

  // 2 行目
  const guide = document.createElement('p');

  // 3 行目
  const toolbar = document.createElement('div');
  toolbar.className = 'mask__toolbar';
  const toolSwitch = createSegment(
    TOOLS.map(([kind, label]) => [label, () => setMaskTool({ kind })])
  );
  toolbar.append(toolSwitch.element);

  // 4 行目
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
  const spacer = document.createElement('span');
  spacer.className = 'mask__spacer';
  // 戻す・全部消すは同じ高さ・同じ枠の 1 つの組にする。ばらばらに置くと道具の段を圧迫していた
  const editPair = document.createElement('div');
  editPair.className = 'pair';
  const undoButton = createButton('戻す', () => maskEditor.undo(), 'button');
  const clearButton = createButton('全部消す', clearMask, 'button');
  editPair.append(undoButton, clearButton);
  row.append(widthSwitch.element, closeButton, spacer, editPair);

  panel.append(head, guide, toolbar, row);

  function render(): void {
    const { backgroundStatus, maskTool, maskUrl, maskPolygon, maskUndoDepth } = photoState.get();
    const hasPhoto = backgroundStatus === 'ready';
    const { kind } = maskTool;

    if (hasPhoto) {
      const { text, done } = guideFor(kind, maskPolygon.length);
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
