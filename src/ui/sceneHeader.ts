/**
 * 編集の画面のヘッダー。真ん中の名前（右に鉛筆）を押すと名前を変える。
 * 一覧に戻るのは下の帯の ←（main.ts）。前はここに「‹」があったが、戻るは画面をまたいで下の帯にそろえた。
 *
 * 名前は、いまのモード（背景か部屋か）で開いているものの名前
 */

import { modeState } from '@/core/mode';
import { currentScene, renameScene, sceneLibrary } from '@/core/sceneLibrary';
import { askName } from '@/ui/nameDialog';
import { createIcon } from '@/ui/icons';

export function createSceneHeader(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'scene-header';

  // 名前と鉛筆は 1 つのボタン。鉛筆があるので、押すと名前を変えられると分かる
  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'scene-header__name';
  name.setAttribute('aria-label', '名前を変える');
  const label = document.createElement('span');
  label.className = 'scene-header__label';
  name.append(label, createIcon('pencil'));
  name.addEventListener('click', async () => {
    const entry = currentScene(modeState.get().mode);
    if (!entry) return;
    const value = await askName(entry.name);
    if (value !== null) renameScene(entry.id, value);
  });

  element.append(name);

  function render(): void {
    const entry = currentScene(modeState.get().mode);
    label.textContent = entry?.name ?? '';
  }

  render();
  sceneLibrary.subscribe(render);
  modeState.subscribe(render);
  return element;
}
