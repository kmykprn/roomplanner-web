import { expect, test, type Page } from '@playwright/test';

/**
 * 背景タブは 1 行だけ（［背景の画像を選ぶ／変更］と［⋯］）。ふだん使わない操作は［⋯］のメニューにしまう。
 * 背景の画像が無いときは［⋯］を出さない（メニューの操作がどれも使えないため）
 */
async function openBackgroundTab(page: Page, withPhoto: boolean): Promise<void> {
  await page.goto('/');
  await page.locator('.sheet__tab').first().waitFor();
  if (withPhoto) {
    await page.evaluate(async () => {
      const { photoState } = await import('/src/core/photoState.ts');
      // 写真があることにする（写真の解析は走らせない）
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 3;
      photoState.set({ backgroundStatus: 'ready', backgroundUrl: canvas.toDataURL(), backgroundAspect: 4 / 3, backgroundName: 'room.png' });
    });
  }
  await page.locator('.sheet__tab', { hasText: '背景' }).click();
}

test('背景の画像が無いときは、「背景の画像を選ぶ」だけを出す', async ({ page }) => {
  await openBackgroundTab(page, false);
  const panel = page.locator('.photo__normal');
  await expect(panel.getByRole('button', { name: '背景の画像を選ぶ' })).toBeVisible();
  await expect(page.getByRole('button', { name: '背景のほかの操作' })).toBeHidden();
});

test('背景の画像があるときは 1 行で、［⋯］からほかの操作を開ける', async ({ page }) => {
  await openBackgroundTab(page, true);
  const panel = page.locator('.photo__normal');
  await expect(panel.getByRole('button', { name: '背景の画像を変更' })).toBeVisible();
  // 小さな見本・見出し・タイルは出さない
  await expect(page.locator('.bg-card, .bg-heading, .bg-tile')).toHaveCount(0);
  await page.getByRole('button', { name: '背景のほかの操作' }).click();
  const menu = page.getByRole('dialog', { name: '背景のほかの操作' });
  await expect(menu.getByRole('button')).toHaveText(['拡大・縮小', '寸法', '家具より手前に表示する範囲', '背景の画像を外す']);
  // 項目を選ぶとメニューは閉じ、その画面に入る
  await menu.getByRole('button', { name: '寸法' }).click();
  await expect(menu).toBeHidden();
  expect(await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().isScaling)).toBe(true);
});

test('メニューの外を押すと閉じ、「背景の画像を外す」で背景が無くなる', async ({ page }) => {
  await openBackgroundTab(page, true);
  const more = page.getByRole('button', { name: '背景のほかの操作' });
  const menu = page.getByRole('dialog', { name: '背景のほかの操作' });
  await more.click();
  await page.locator('.bg-menu__dim').click({ position: { x: 20, y: 20 } });
  await expect(menu).toBeHidden();
  await more.click();
  await menu.getByRole('button', { name: '背景の画像を外す' }).click();
  await expect(menu).toBeHidden();
  expect(await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().backgroundStatus)).not.toBe('ready');
  await expect(page.locator('.photo__normal').getByRole('button', { name: '背景の画像を選ぶ' })).toBeVisible();
  await expect(more).toBeHidden();
});
