/**
 * 「家具より手前に表示する範囲」の画面。写真モードの「背景」タブの「背景の調整」から入る。
 *
 * 背景の画像の中で家具より手前にある物（机など）を指定してもらう。指定した部分は
 * 背景の画像が家具の上にかぶさるので、後ろへ動かした家具が隠れる。
 *
 *   上の段 … 「‹ 戻る」と見出し（ui/subScreen.ts）
 *   案内   … いまなにをすればいいかを、道具と進み具合に合わせて 1 文で出す
 *   部品   … 道具（なぞる・囲む・消す）と、道具ごとの設定（細い・太い、囲みを閉じる）を 1 行に
 *   下の段 … 「ひとつ戻す」「すべて消す」と「保存」
 *
 * 「戻る」は入ったときの形に戻す（core/maskEditor.ts の cancelSession）。
 * 指の操作は interaction/maskPaint.ts、形を描く中身は core/maskEditor.ts。
 */

import { MIN_CORNERS, maskEditor } from '@/core/maskEditor';
import { createQuietButton, createSubScreen } from '@/ui/subScreen';
import {
  clearMask,
  photoState,
  setMasking,
  setMaskTool,
  type MaskToolKind,
} from '@/core/photoState';

const NO_PHOTO = '先に「背景」タブで背景の画像を選んでください';

const TOOLS: Array<[MaskToolKind, string]> = [
  ['brush', 'なぞる'],
  ['polygon', '囲む'],
  ['eraser', '消す'],
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
      return { text: '指でなぞった部分は、家具よりも手前に表示されます。', done: false };
    case 'eraser':
      return { text: '指でなぞった部分は、家具よりも手前に表示されなくなります。', done: false };
    case 'polygon':
      if (corners === 0) {
        return { text: '物のふちに沿って点をタップすると、囲んだ範囲が家具よりも手前に表示されます。', done: false };
      }
      if (corners < MIN_CORNERS) {
        return { text: `点をあと ${MIN_CORNERS - corners} 個タップすると、範囲を囲むことができます。`, done: false };
      }
      return { text: '最初の点をもう一度タップすると、囲んだ範囲が家具よりも手前に表示されます。', done: true };
  }
}

export function createMaskPanel(): HTMLElement {
  const screen = createSubScreen({
    title: '家具より手前に表示する範囲',
    onBack: () => {
      maskEditor.cancelSession();
      setMasking(false);
    },
    onDone: () => setMasking(false),
  });
  const panel = screen.element;
  panel.classList.add('mask');

  const guide = document.createElement('p');

  // 道具と、道具ごとの設定を 1 行に。入れ替わっても高さは変えない（写真が伸び縮みしないように）
  const row = document.createElement('div');
  row.className = 'mask__row';
  const toolSwitch = createSegment(TOOLS.map(([kind, label]) => [label, () => setMaskTool({ kind })]));
  toolSwitch.element.classList.add('mask__tools');
  const widthSwitch = createSegment([
    ['細い', () => setMaskTool({ thick: false })],
    ['太い', () => setMaskTool({ thick: true })],
  ]);
  const closeButton = createButton('囲みを閉じる', () => maskEditor.closePolygon(), 'button is-small');
  row.append(toolSwitch.element, widthSwitch.element, closeButton);
  screen.body.append(guide, row);

  const undoButton = createQuietButton('ひとつ戻す', () => maskEditor.undo());
  const clearButton = createQuietButton('すべて消す', clearMask);
  screen.actions.append(undoButton, clearButton);

  /** 画面に入った瞬間を見つけて、そのときの形を控える */
  let wasMasking = false;

  function render(): void {
    const { backgroundStatus, maskTool, maskUrl, maskPolygon, maskUndoDepth, isMasking } = photoState.get();
    if (isMasking && !wasMasking) maskEditor.beginSession();
    wasMasking = isMasking;
    panel.hidden = !isMasking;
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
