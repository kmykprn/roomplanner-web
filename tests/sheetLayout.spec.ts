import { expect, test, type Page } from '@playwright/test';

/**
 * 下のタブは、写真モードなら「背景」「操作」、部屋モードなら「内装」「操作」の 2 つ（家具のタブは無い）。
 * 家具のページは、操作タブの［＋ 家具を追加］と、家具を選んでいる間の名前の右の［＋］から開く。
 * 写真の背景タブのふだんの姿（1 行だけ）のときは、下のパネルを中身の高さまで低くする
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

/** パネルの高さ。高さを滑らかに変えている途中で測らないよう、変わり終わるのを待つ */
async function sheetHeight(page: Page): Promise<number> {
  await page.waitForTimeout(350);
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

test('背景タブのふだんの姿ではパネルを低くし、操作タブと背景の調整の画面では今の高さにする', async ({ page }) => {
  await open(page, true);
  await page.locator('.sheet__tab', { hasText: '背景' }).click();
  const compact = await sheetHeight(page);
  await page.locator('.sheet__tab', { hasText: '操作' }).click();
  const manage = await sheetHeight(page);
  expect(compact).toBeLessThan(150);
  expect(manage).toBeGreaterThan(compact + 100);
  // 背景の調整の画面（拡大・縮小）に入ると、今の高さに戻す
  await page.locator('.sheet__tab', { hasText: '背景' }).click();
  expect(await sheetHeight(page)).toBeCloseTo(compact, 0);
  await page.getByRole('button', { name: '背景のほかの操作' }).click();
  await page.getByRole('button', { name: '拡大・縮小' }).click();
  expect(await sheetHeight(page)).toBeCloseTo(manage, 0);
  // 1 行が隠れずに全部見える
  await page.getByRole('button', { name: '‹ 戻る' }).filter({ visible: true }).click();
  expect(await sheetHeight(page)).toBeCloseTo(compact, 0);
  const row = (await page.locator('.bg-row').boundingBox())!;
  const sheet = (await page.locator('.sheet').boundingBox())!;
  expect(row.y + row.height).toBeLessThanOrEqual(sheet.y + sheet.height);
});
