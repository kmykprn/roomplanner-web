/**
 * 部屋モードと写真モードの切り替え。
 *
 * ヘッダーに置く。どちらを触っているかは常に見えている必要があり、
 * 下部シートのタブ（設置／操作）とは階層が違うので分けてある。
 */

import { modeState, setMode, type Mode } from '@/core/mode';

/** 左が背景（写真）、右が部屋。写真に家具を置くのが主な使い方なので、背景を先に置く */
const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'photo', label: '背景' },
  { id: 'room', label: '部屋' },
];

export function createModeSwitch(): HTMLElement {
  const group = document.createElement('div');
  group.className = 'mode-switch';

  const buttons = MODES.map((mode) => {
    const button = document.createElement('button');
    button.className = 'mode-switch__item';
    button.textContent = mode.label;
    button.addEventListener('click', () => setMode(mode.id));
    group.appendChild(button);
    return button;
  });

  function render(): void {
    const current = modeState.get().mode;
    buttons.forEach((button, index) => {
      button.classList.toggle('is-active', MODES[index].id === current);
    });
  }

  render();
  modeState.subscribe(render);

  return group;
}
