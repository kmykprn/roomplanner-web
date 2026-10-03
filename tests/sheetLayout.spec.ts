import { expect, test, type Page } from '@playwright/test';

/**
 * 下のタブは、写真モードなら「背景」「操作」、部屋モードなら「内装」「操作」の 2 つ（家具のタブは無い）。
 * 家具のページは、操作タブの［＋ 家具を追加］と、家具を選んでいる間の名前の右の［＋］から開く。
 * 下のパネルの高さは、どのタブでも同じ（タブを切り替えても、写真の見える範囲が変わらない）
 */
async function open(page: Page, withPhoto: boolean): Promise<void> {
  await page.goto('/');
  await page.locator('.sheet__tab').first().waitFor();
  if (withPhoto) {
    await page.evaluate(async () => {
      const { photoState } = await import('/src/core/photoState.ts');
      // 写真があることにする（写真の解析は走らせない）
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 3;
      photoState.set({ backgroundStatus: 'ready', backgroundUrl: canvas.toDataURL(), backgroundAspect: 4 / 3 });
    });
  }
}

/** パネルの高さ */
async function sheetHeight(page: Page): Promise<number> {
  await page.waitForTimeout(100);
  return (await page.locator('.sheet').boundingBox())!.height;
}

test('タブは 2 つで、家具のタブは無い', async ({ page }) => {
  await open(page, false);
  await expect(page.locator('.sheet__tab')).toHaveText(['背景', '操作']);
  await page.evaluate(async () => (await import('/src/core/mode.ts')).setMode('room'));
  await expect(page.locator('.sheet__tab')).toHaveText(['内装', '操作']);
});

test('操作タブの［＋ 家具を追加］と、選んでいる家具の名前の右の［＋］で、家具のページを開く', async ({ page }) => {
  await open(page, true);
  await page.locator('.sheet__tab', { hasText: '操作' }).click();
  await page.locator('.manage__add', { hasText: '家具を追加' }).click();
  await expect(page.locator('.page')).toBeVisible();
  await page.locator('.page__close').click();
  await expect(page.locator('.page')).toBeHidden();
  await page.evaluate(async () => {
    const { activeScene } = await import('/src/core/mode.ts');
    const scene = activeScene();
    scene.add({ id: 'box', typeId: 'box', name: '箱', color: '#888888', size: [0.6, 0.8, 0.6], baseSize: [0.6, 0.8, 0.6], position: [0, 0, 0], rotationY: 0 });
    scene.select('box');
  });
  await page.locator('.manage__head').getByRole('button', { name: '家具を追加' }).click();
  await expect(page.locator('.page')).toBeVisible();
});

test('背景タブと操作タブ、背景の調整の画面で、パネルの高さは同じ', async ({ page }) => {
  await open(page, true);
  await page.locator('.sheet__tab', { hasText: '背景' }).click();
  const background = await sheetHeight(page);
  await page.locator('.sheet__tab', { hasText: '操作' }).click();
  expect(await sheetHeight(page)).toBeCloseTo(background, 0);
  await page.locator('.sheet__tab', { hasText: '背景' }).click();
  await page.getByRole('button', { name: '背景のほかの操作' }).click();
  await page.getByRole('button', { name: '拡大・縮小' }).click();
  expect(await sheetHeight(page)).toBeCloseTo(background, 0);
  // 低くしていたころの高さ（約 110px）ではなく、今までの高さ（画面の 42%、最低 280px）
  expect(background).toBeGreaterThanOrEqual(280);
});
