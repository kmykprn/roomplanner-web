/**
 * 「家具より手前に表示する範囲」の画面。写真モードの「背景」タブの「背景の調整」から入る。
 *
 * 背景の画像の中で家具より手前にある物（机など）を指定してもらう。指定した部分は
 * 背景の画像が家具の上にかぶさるので、後ろへ動かした家具が隠れる。
 *
 *   上の段 … 「‹ 戻る」と見出し（ui/subScreen.ts）
 *   案内   … いまなにをすればいいかを、道具と進み具合に合わせて 1 文で出す（消しゴムは出さない）
 *   部品   … 道具（なぞる・点で囲む・消しゴム）と、道具ごとの設定（細い・太い、囲みを閉じる）を 1 行に
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

const TOOLS: Array<[MaskToolKind, string]> = [
  ['brush', 'なぞる'],
  ['polygon', '点で囲む'],
  ['eraser', '消しゴム'],
];

/**
 * 今なにをすればいいかの 1 文。done は「押すべきものが現れた」状態で、案内の色を緑にする。
 * 消しゴムは名前で何が起きるか分かるので null（案内を出さない）。
 *
 * 目的の文（「手前に表示したいエリアを…」）だけでは、指でなぞるのか点を打つのかが
 * 分からず、押してみて初めて分かる状態だった。道具と進み具合ごとに動作を書く。
 *
 * 緑になるのは囲むの 3 点以上だけ。なぞるは塗り続けるだけで「次に押すもの」が無いので、
 * 塗った後も文と色を変えない（一筆で緑になって以後ずっと緑、が気持ち悪かった）
 */
function guideFor(kind: MaskToolKind, corners: number): { text: string; done: boolean } | null {
  switch (kind) {
    case 'brush':
      return { text: '画面上を指でなぞると、なぞった部分は家具よりも手前に表示されるようになります。', done: false };
    case 'eraser':
      // 「消しゴム」の名前で何が起きるか分かるので、案内は出さない
      return null;
    case 'polygon':
      if (corners === 0) {
        return { text: '家具よりも手前に表示する範囲を、点をつなげて指定してください。', done: false };
      }
      if (corners < MIN_CORNERS) {
        return { text: `点をあと ${MIN_CORNERS - corners} 個タップすると、範囲を囲むことができます。`, done: false };
      }
      // 最初の点をもう一度タップしても閉じられるが、案内には閉じ方を 1 つだけ書く
      return { text: '「囲みを閉じる」を押すと、囲んだ範囲が家具よりも手前に表示されます。', done: true };
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
    const { maskTool, maskUrl, maskPolygon, maskUndoDepth, isMasking } = photoState.get();
    if (isMasking && !wasMasking) maskEditor.beginSession();
    wasMasking = isMasking;
    panel.hidden = !isMasking;
    // この画面へは背景の画像があるときしか入れない（タイルが画像のあるときだけ出る）ので、画像の有無は見ない
    const { kind } = maskTool;

    const next = guideFor(kind, maskPolygon.length);
    guide.hidden = next === null;
    if (next) {
      guide.className = next.done ? 'mask__guide is-done' : 'mask__guide';
      guide.textContent = next.text;
    }

    toolSwitch.setActive(TOOLS.findIndex(([id]) => id === kind));
    undoButton.disabled = maskUndoDepth === 0 && maskPolygon.length === 0;
    clearButton.disabled = !maskUrl;

    // 道具ごとに要るものだけ出す
    widthSwitch.element.hidden = kind === 'polygon';
    widthSwitch.setActive(maskTool.thick ? 1 : 0);
    closeButton.hidden = kind !== 'polygon';
    closeButton.disabled = maskPolygon.length < MIN_CORNERS;
  }

  render();
  photoState.subscribe(render);
  return panel;
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
  };
}
