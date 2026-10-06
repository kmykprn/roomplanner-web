/**
 * 編集の画面のヘッダー。左の「‹」で一覧に戻り、名前を押すと名前を変える。
 *
 * 名前は、いまのモード（背景か部屋か）で開いているものの名前。
 * 前はここに背景と部屋の切り替えがあったが、切り替えは一覧の下のタブに移した（ui/scenePage.ts）
 */

import { modeState } from '@/core/mode';
import { currentScene, renameScene, sceneLibrary } from '@/core/sceneLibrary';
import { askName } from '@/ui/nameDialog';
import { createIcon } from '@/ui/icons';

export function createSceneHeader(onBack: () => void): HTMLElement {
  const element = document.createElement('div');
  element.className = 'scene-header';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'scene-header__back';
  back.setAttribute('aria-label', '一覧に戻る');
  back.append(createIcon('chevron-left'));
  back.addEventListener('click', onBack);

  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'scene-header__name';
  name.setAttribute('aria-label', '名前を変える');
  name.addEventListener('click', async () => {
    const entry = currentScene(modeState.get().mode);
    if (!entry) return;
    const value = await askName(entry.name);
    if (value !== null) renameScene(entry.id, value);
  });

  element.append(back, name);

  function render(): void {
    const entry = currentScene(modeState.get().mode);
    name.textContent = entry?.name ?? '';
  }

  render();
  sceneLibrary.subscribe(render);
  modeState.subscribe(render);
  return element;
}
