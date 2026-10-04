import { expect, test, type Page } from '@playwright/test';
import { openTab } from './helpers';

/**
 * 下のタブは、部屋モードなら「内装」「操作」の 2 つ（家具のタブは無い）。写真モードは操作だけで、タブの帯を出さない
 * （背景の操作は写真の右上の［⋯］）。
 * 家具のページは、操作タブの［＋ 家具を追加］と、家具を選んでいる間の見出しの右の［＋］から開く。
 * 下のパネルの高さは、どのタブでも、背景の調整の画面でも同じ（写真の見える範囲が変わらない）
 */
async function open(page: Page, withPhoto: boolean): Promise<void> {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
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

test('部屋モードのタブは 2 つで家具のタブは無く、写真モードはタブの帯を出さない', async ({ page }) => {
  await open(page, false);
  await expect(page.locator('.sheet__tabs')).toBeHidden();
  await page.evaluate(async () => (await import('/src/core/mode.ts')).setMode('room'));
  await expect(page.locator('.sheet__tab')).toHaveText(['内装', '操作']);
});

test('操作タブの［＋ 家具を追加］と、家具を選んでいる間の見出しの右の［＋］で、家具のページを開く', async ({ page }) => {
  await open(page, true);
  await openTab(page, '操作');
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

test('写真モードの一覧と背景の調整の画面、部屋モードのタブで、パネルの高さは同じ', async ({ page }) => {
  await open(page, true);
  const background = await sheetHeight(page);
  await page.locator('.photo-menu__button').click();
  await page.getByRole('button', { name: '拡大・縮小' }).click();
  expect(await sheetHeight(page)).toBeCloseTo(background, 0);
  await page.locator('.sub:visible button', { hasText: '戻る' }).click();
  await page.evaluate(async () => (await import('/src/core/mode.ts')).setMode('room'));
  expect(await sheetHeight(page)).toBeCloseTo(background, 0);
  // 低くしていたころの高さ（約 110px）ではなく、今までの高さ（画面の 42%、最低 280px）
  expect(background).toBeGreaterThanOrEqual(280);
});
