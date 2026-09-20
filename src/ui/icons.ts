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

export type IconName =
  | 'trash' | 'check' | 'plus' | 'camera' | 'link' | 'cube';

/** 24px グリッド。線は 1.9px、端と角は丸（CSS の .ic で指定） */
const PATHS: Record<IconName, string[]> = {
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6M14 11v6'],
  // 完了: 「終える」操作だと分かるように
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  // 家具タブの「作る」: ＋タイルと、作り方（写真・商品ページ・3D）の 3 行
  plus: ['M12 5v14', 'M5 12h14'],
  camera: ['M4 8h3l2-3h6l2 3h3v11H4z', 'M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7'],
  link: ['M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5', 'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5'],
  cube: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M4 7.5l8 4.5 8-4.5', 'M12 12v9'],
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
