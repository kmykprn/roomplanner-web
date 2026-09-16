/**
 * 部屋モードの「内装」タブ。テンプレートのタイルを並べ、押すと壁 3 面と床の柄が変わる。
 *
 * 和室を選んだときだけ、下に畳数（6 / 8 / 10）の切り替えが出る。畳は半端に切れないので、
 * 畳数で部屋の大きさも決まる（config/interior.ts の roomSizeFor）。
 * 柄そのものは scene/interiorTextures.ts が描く。ここは選ぶだけ
 */

import { INTERIOR_TEMPLATES, TATAMI_CHOICES, type TatamiMats } from '@/config/interior';
import { appState, setInterior } from '@/core/appState';

export function createInteriorPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'interior';

  const grid = document.createElement('div');
  grid.className = 'interior__grid';
  const tiles = new Map<string, HTMLButtonElement>();
  for (const template of INTERIOR_TEMPLATES) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'interior__tile';
    const picture = document.createElement('img');
    picture.className = 'interior__picture';
    picture.src = template.thumbnail;
    picture.alt = '';
    picture.decoding = 'async';
    const name = document.createElement('span');
    name.className = 'interior__name';
    name.textContent = template.name;
    tile.append(picture, name);
    tile.addEventListener('click', () => setInterior({ template: template.id }));
    tiles.set(template.id, tile);
    grid.append(tile);
  }

  // --- 畳数。和室のときだけ ---
  const matsRow = document.createElement('div');
  matsRow.className = 'interior__mats';
  const matsLabel = document.createElement('span');
  matsLabel.className = 'interior__mats-label';
  matsLabel.textContent = '畳数';
  const seg = document.createElement('div');
  seg.className = 'seg';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', '畳数');
  const matsButtons = new Map<TatamiMats, HTMLButtonElement>();
  for (const mats of TATAMI_CHOICES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'seg__item';
    button.textContent = `${mats} 畳`;
    button.addEventListener('click', () => setInterior({ mats }));
    matsButtons.set(mats, button);
    seg.append(button);
  }
  const matsNote = document.createElement('p');
  matsNote.className = 'hint';
  matsNote.textContent = '畳数に合わせて部屋の大きさが変わります';
  matsRow.append(matsLabel, seg, matsNote);

  panel.append(grid, matsRow);

  function render(): void {
    const { interior } = appState.get();
    for (const [id, tile] of tiles) tile.setAttribute('aria-pressed', String(id === interior.template));
    matsRow.hidden = interior.template !== 'japanese';
    for (const [mats, button] of matsButtons) button.setAttribute('aria-pressed', String(mats === interior.mats));
  }
  render();
  appState.subscribe(render);

  return panel;
}
