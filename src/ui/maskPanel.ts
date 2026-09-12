/**
 * 写真モードの「隠す」タブ。
 *
 * 写真の中で家具の手前にある物（机など）を、筆か囲うで塗ってもらう。
 * 塗った場所は写真が家具の手前に出るので、後ろへ動かした家具が隠れる。
 *
 * 道具ごとに要るものだけを出す。筆には太さ、囲うには「閉じて塗る」「1つ戻す」。
 * 塗る／消すはどの道具にも効く。
 * 指の操作は interaction/maskPaint.ts、形を描く中身は core/maskEditor.ts。
 */

import { maskEditor } from '@/core/maskEditor';
import { clearMask, photoState, setMaskTool, type MaskToolKind } from '@/core/photoState';

const NO_PHOTO = '先に「背景」タブで写真を選んでください';
const GUIDES: Record<MaskToolKind, string> = {
  brush: '家具の手前にある物を、写真の上でなぞってください',
  polygon: '物の角を順にタップして囲い、「閉じて塗る」を押してください',
};
const HINT = '2本指で寄ると細かく作れます。塗った場所は青く見えます';

const TOOLS: Array<[MaskToolKind, string]> = [
  ['brush', '筆'],
  ['polygon', '囲う'],
];

export function createMaskPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'mask';

  const status = document.createElement('p');
  status.className = 'hint';

  const toolSwitch = createSegment(
    TOOLS.map(([kind, label]) => [label, () => setMaskTool({ kind })])
  );
  const modeSwitch = createSegment([
    ['塗る', () => setMaskTool({ erase: false })],
    ['消す', () => setMaskTool({ erase: true })],
  ]);
  const widthSwitch = createSegment([
    ['細い', () => setMaskTool({ thick: false })],
    ['太い', () => setMaskTool({ thick: true })],
  ]);

  const controls = document.createElement('div');
  controls.className = 'mask__controls';
  controls.append(modeSwitch.element, widthSwitch.element);

  // 囲う: 閉じる・戻す
  const polygonActions = document.createElement('div');
  polygonActions.className = 'mask__actions';
  const closeButton = createButton('閉じて塗る', () => maskEditor.closePolygon(), 'button');
  const undoButton = createButton('1つ戻す', () => maskEditor.undoCorner(), 'button is-quiet');
  polygonActions.append(closeButton, undoButton);

  const hint = document.createElement('p');
  hint.className = 'hint mask__note';
  hint.textContent = HINT;

  const clearButton = createButton('全部消す', clearMask, 'button is-quiet');

  panel.append(status, toolSwitch.element, controls, polygonActions, hint, clearButton);

  function render(): void {
    const { backgroundStatus, maskTool, maskUrl, maskPolygon } = photoState.get();
    const hasPhoto = backgroundStatus === 'ready';
    const { kind } = maskTool;

    status.textContent = hasPhoto ? GUIDES[kind] : NO_PHOTO;
    hint.hidden = !hasPhoto;

    toolSwitch.setActive(TOOLS.findIndex(([id]) => id === kind));
    toolSwitch.setEnabled(hasPhoto);
    modeSwitch.setActive(maskTool.erase ? 1 : 0);
    modeSwitch.setEnabled(hasPhoto);

    // 道具ごとに要るものだけ出す。並ぶものを減らして、いま何を触っているか分かるように
    widthSwitch.element.hidden = kind !== 'brush';
    widthSwitch.setActive(maskTool.thick ? 1 : 0);
    widthSwitch.setEnabled(hasPhoto);

    polygonActions.hidden = kind !== 'polygon';
    closeButton.textContent =
      maskPolygon.length > 0 ? `閉じて塗る（${maskPolygon.length}点）` : '閉じて塗る';
    closeButton.disabled = maskPolygon.length < 3;
    undoButton.disabled = maskPolygon.length === 0;

    clearButton.disabled = !hasPhoto || !maskUrl;
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
