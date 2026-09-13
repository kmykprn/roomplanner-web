/**
 * 操作に使う線のアイコン。
 *
 * 記号（⟲ ↑ − など）を文字で出すと、端末のフォント任せになって線の太さや
 * 天地がばらつく。自前の SVG にして、アプリのアイコン（assets-src/icon.svg）と
 * 同じ「丸い端・丸い角」の線で揃える。
 *
 * 1 つの SVG スプライトを最初に使うときに body へ 1 度だけ入れ、各所は
 * <use href="#..."> で参照する。外部ファイルにしないのは、オフラインでも
 * 必ず出るようにするため。色は currentColor で、置いた場所の文字色に従う。
 */

export type IconName = 'rotateLeft' | 'rotateRight' | 'shrink' | 'grow' | 'down' | 'up' | 'trash';

/** 24px グリッド。線は 1.9px、端と角は丸（CSS の .ic で指定） */
const PATHS: Record<IconName, string[]> = {
  // 向き: 270° の弧と、弧の終端に進む向きの矢じり
  rotateLeft: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
  rotateRight: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
  // 大きさ: 四隅へ向く矢印。縮む／広がる
  shrink: ['M9 4v5H4', 'M15 20v-5h5', 'M4 4l5 5', 'M20 20l-5-5'],
  grow: ['M14 4h6v6', 'M10 20H4v-6', 'M20 4l-6 6', 'M4 20l6-6'],
  // 高さ: 上下の矢印に床の線。「回す」の矢印と見分けるため
  down: ['M12 4v11', 'M8 11l4 4 4-4', 'M5 20h14'],
  up: ['M12 15V4', 'M8 8l4-4 4 4', 'M5 20h14'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6M14 11v6'],
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const SPRITE_ID = 'icon-sprite';

/** スプライトを 1 度だけ body に入れる */
function ensureSprite(): void {
  if (document.getElementById(SPRITE_ID)) return;
  const sprite = document.createElementNS(SVG_NS, 'svg');
  sprite.id = SPRITE_ID;
  sprite.setAttribute('width', '0');
  sprite.setAttribute('height', '0');
  sprite.setAttribute('aria-hidden', 'true');
  sprite.style.position = 'absolute';
  const defs = document.createElementNS(SVG_NS, 'defs');
  for (const [name, paths] of Object.entries(PATHS)) {
    const symbol = document.createElementNS(SVG_NS, 'symbol');
    symbol.id = `icon-${name}`;
    symbol.setAttribute('viewBox', '0 0 24 24');
    for (const d of paths) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      symbol.appendChild(path);
    }
    defs.appendChild(symbol);
  }
  sprite.appendChild(defs);
  document.body.prepend(sprite);
}

/** アイコンの要素を作る。文字色に従い、大きさは CSS の .ic で決める */
export function createIcon(name: IconName): SVGSVGElement {
  ensureSprite();
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('ic');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#icon-${name}`);
  svg.appendChild(use);
  return svg;
}
