import { expect, test } from '@playwright/test';
import { openTab , enterEditor} from './helpers';

/**
 * 操作タブの一覧（何も選んでいないとき）は、どの端末でもタイルが 2 段そろって切れずに見える。
 * ［＋ 家具を追加］と家具のタイルは同じ大きさ。「ひとつ戻す」は出さない
 */
const SCREENS: Array<[string, number, number]> = [
  ['Android（小）', 360, 640],
  ['iPhone SE', 375, 667],
  ['iPhone 14', 390, 844],
  ['iPhone 15 Pro Max', 430, 932],
];

for (const [name, width, height] of SCREENS) {
  test(`${name}（${width}×${height}）: タイルが 2 段そろって見え、［＋］と家具のタイルが同じ大きさ`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.locator('.sheet').first().waitFor();
    await enterEditor(page);
    await page.evaluate(async () => {
      const { activeScene } = await import('/src/core/mode.ts');
      const scene = activeScene();
      for (let i = 0; i < 9; i += 1) {
        scene.add({ id: `f${i}`, typeId: 'generated', name: `家具 ${i}`, color: '#888888', imageUrl: '/src/assets/furniture/chair-cutout.webp', size: [0.5, 0.9, 0.5], position: [i * 0.1, 0, 0], rotationY: 0 });
      }
      scene.select(null);
    });
    await openTab(page, '操作');
    const result = await page.evaluate(() => {
      const body = document.querySelector('.sheet__body')!;
      const style = getComputedStyle(body);
      const bottom = body.getBoundingClientRect().bottom - parseFloat(style.paddingBottom);
      const tiles = [...document.querySelectorAll('.manage__grid > .manage__tile')].map((tile) => tile.getBoundingClientRect());
      const tops = [...new Set(tiles.map((r) => Math.round(r.top)))].sort((a, b) => a - b);
      const secondRowBottom = Math.max(...tiles.filter((r) => Math.round(r.top) === tops[1]).map((r) => r.bottom));
      return {
        sizes: [...new Set(tiles.map((r) => `${Math.round(r.width)}×${Math.round(r.height)}`))],
        secondRowBottom,
        bottom,
        thirdRowTop: tops[2] ?? Infinity,
      };
    });
    // ［＋ 家具を追加］も家具のタイルも、同じ大きさの正方形
    expect(result.sizes).toHaveLength(1);
    const [w, h] = result.sizes[0].split('×').map(Number);
    expect(w).toBe(h);
    // 2 段目までがパネルの中に収まり、3 段目は 2 段目より下（スクロールで見る）
    expect(result.secondRowBottom).toBeLessThanOrEqual(result.bottom + 0.5);
    expect(result.thirdRowTop).toBeGreaterThan(result.secondRowBottom);
    await expect(page.getByRole('button', { name: 'ひとつ戻す' })).toHaveCount(0);
  });
}
