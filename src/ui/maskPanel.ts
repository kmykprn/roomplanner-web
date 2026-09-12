/**
 * 写真モードの「隠す」タブ。
 *
 * 写真の中で家具の手前にある物（机など）を指でなぞってもらう。
 * 塗った場所は写真が家具の手前に出るので、後ろへ動かした家具が隠れる。
 * 塗る操作そのものは interaction/maskPaint.ts。ここは筆の設定と案内だけ。
 */

import { clearMask, photoState, setMaskTool } from '@/core/photoState';

const GUIDE = '家具の手前にある物（机など）を、写真の上でなぞってください';
const NO_PHOTO = '先に「背景」タブで写真を選んでください';
const HINT = '2本指で寄ると細かく塗れます。塗った場所は青く見えます';

export function createMaskPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'mask';

  const status = document.createElement('p');
  status.className = 'hint';

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

  const hint = document.createElement('p');
  hint.className = 'hint mask__note';
  hint.textContent = HINT;

  const clearButton = document.createElement('button');
  clearButton.className = 'button is-quiet';
  clearButton.textContent = '全部消す';
  clearButton.addEventListener('click', clearMask);

  panel.append(status, controls, hint, clearButton);

  function render(): void {
    const { backgroundStatus, maskTool, maskUrl } = photoState.get();
    const hasPhoto = backgroundStatus === 'ready';

    status.textContent = hasPhoto ? GUIDE : NO_PHOTO;
    hint.hidden = !hasPhoto;
    modeSwitch.setActive(maskTool.erase ? 1 : 0);
    widthSwitch.setActive(maskTool.thick ? 1 : 0);
    modeSwitch.setEnabled(hasPhoto);
    widthSwitch.setEnabled(hasPhoto);
    clearButton.disabled = !hasPhoto || !maskUrl;
  }

  render();
  photoState.subscribe(render);
  return panel;
}

/** 2つから選ぶ切り替え。どちらが選ばれているかは状態から描く */
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
