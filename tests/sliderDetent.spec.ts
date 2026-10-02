import { expect, test } from '@playwright/test';

/**
 * 操作タブのバーには目盛りがあり、指で動かして真ん中（向きの 0°・大きさの 100%）の近くに来ると吸い付く。
 * 真ん中から離れた所では吸い付かず、指の位置どおりの値になる
 */
test.describe('操作タブのバーの目盛りと吸い付き', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.sheet__tab').first().waitFor();
    await page.evaluate(async () => {
      const { activeScene } = await import('/src/core/mode.ts');
      const scene = activeScene();
      scene.add({ id: 'box', typeId: 'box', name: '箱', color: '#888888', size: [0.6, 0.8, 0.6], baseSize: [0.6, 0.8, 0.6], position: [0, 0, 0], rotationY: 0.5 });
      scene.select('box');
    });
    await page.locator('.sheet__tab', { hasText: '操作' }).click();
  });

  /** 「向き」のバーで、つまみを掴んで、値 degrees の位置まで動かす */
  async function dragRotationTo(page: import('@playwright/test').Page, degrees: number): Promise<number> {
    const range = page.locator('.slider-row', { hasText: '向き' }).locator('input[type=range]');
    const box = (await range.boundingBox())!;
    const travel = box.width - 22;
    const xOf = (value: number) => box.x + 11 + ((value + 180) / 360) * travel;
    const y = box.y + box.height / 2;
    const current = Number(await range.inputValue());
    await page.mouse.move(xOf(current), y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) await page.mouse.move(xOf(current + ((degrees - current) * step) / 6), y);
    await page.mouse.up();
    return page.evaluate(async () => {
      const { activeScene } = await import('/src/core/mode.ts');
      const item = activeScene().state().furniture.find((f) => f.id === 'box')!;
      return Math.round((item.rotationY * 180) / Math.PI);
    });
  }

  test('目盛りを出し、真ん中を目立たせる', async ({ page }) => {
    const row = page.locator('.slider-row', { hasText: '向き' });
    await expect(row.locator('.slider-row__tick')).toHaveCount(9);
    await expect(row.locator('.slider-row__tick.is-main')).toHaveCount(1);
    await expect(row.locator('.slider-row__mark-label.is-main')).toHaveText('0°');
    const scale = page.locator('.slider-row', { hasText: '大きさ' });
    await expect(scale.locator('.slider-row__mark-label.is-main')).toHaveText('100%');
  });

  test('真ん中の近くでは 0° に吸い付く', async ({ page }) => {
    expect(await dragRotationTo(page, 4)).toBe(0);
  });

  test('真ん中から離れた所では吸い付かない', async ({ page }) => {
    const degrees = await dragRotationTo(page, 30);
    expect(Math.abs(degrees - 30)).toBeLessThanOrEqual(2);
  });
});
