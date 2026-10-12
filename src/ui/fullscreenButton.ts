/**
 * 絵（写真や部屋）を全画面で見る。絵の右下の白い丸のボタンで切り替える。
 *
 * 押すとヘッダーと下のシートを隠して絵だけにし、同じ場所のボタン（内向きの矢印）で戻す。
 * 矢印の向きと位置は YouTube の全画面ボタンと同じ（左上へ と 右下へ）。
 * 全画面の間は見るための姿なので、家具は選ばず動かさない（main.ts で isFullscreen を見て止める）
 */

import { createIcon } from '@/ui/icons';

export interface FullscreenButton {
  element: HTMLElement;
  isFullscreen(): boolean;
}

export function createFullscreenButton(app: HTMLElement, onChange: (full: boolean) => void): FullscreenButton {
  let full = false;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'view-full';
  // 絵の上の操作（家具を掴む・カメラを回す）に押した指を渡さない
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('click', () => {
    full = !full;
    app.classList.toggle('is-full', full);
    render();
    onChange(full);
  });
  function render(): void {
    button.replaceChildren(createIcon(full ? 'shrink' : 'expand'));
    button.setAttribute('aria-label', full ? '全画面をやめる' : '全画面');
  }
  render();
  return { element: button, isFullscreen: () => full };
}
