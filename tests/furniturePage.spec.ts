import { expect, test } from '@playwright/test';

/**
 * 下のタブの「家具」を押すと、家具のページが画面全体に開く。家具を押すと「背景に追加」（部屋なら「部屋に追加」）と編集の鉛筆のメニューが出る。
 * 追加で置くとページを閉じて「操作」タブを出し、「×」で閉じると元のタブに戻る
 */
test.describe('家具のページ', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.sheet__tab').first().waitFor();
  });

  async function openFirstModel(page: import('@playwright/test').Page): Promise<void> {
    await page.locator('.sheet__tab', { hasText: '家具' }).click();
    await expect(page.locator('.page')).toBeVisible();
    // 一覧の先頭は「追加」のタイルなので、その次（最初の家具）を押す
    const tile = page.locator('.page .thumb__button').nth(1);
    await tile.click();
    await expect(page.locator('.tile-actions')).toBeVisible();
  }

  test('家具を押すとメニューが出て、まだ置かれない。外側を押すと閉じる', async ({ page }) => {
    await openFirstModel(page);
    await expect(page.locator('.tile-actions__button', { hasText: '背景に追加' })).toBeVisible();
    // ボタンは追加の 1 つだけ。編集は名前の右の鉛筆
    await expect(page.locator('.tile-actions__button')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '編集' })).toBeVisible();
    const placed = await page.evaluate(async () => (await import('/src/core/mode.ts')).activeScene().state().furniture.length);
    expect(placed).toBe(0);
    await page.locator('.tile-actions__dim').click({ position: { x: 20, y: 20 } });
    await expect(page.locator('.tile-actions')).toBeHidden();
  });

  test('「背景に追加」で置くと、ページを閉じて操作タブを出す', async ({ page }) => {
    await openFirstModel(page);
    await page.locator('.tile-actions__button', { hasText: '背景に追加' }).click();
    await expect(page.locator('.page')).toBeHidden();
    await expect(page.locator('.sheet__tab.is-active')).toHaveText('操作');
    const placed = await page.evaluate(async () => (await import('/src/core/mode.ts')).activeScene().state().furniture.length);
    expect(placed).toBe(1);
  });

  test('鉛筆で編集の画面を開き、「×」で閉じると元のタブに戻る', async ({ page }) => {
    const before = await page.locator('.sheet__tab.is-active').textContent();
    await openFirstModel(page);
    await page.getByRole('button', { name: '編集' }).click();
    await expect(page.locator('.page .edit__title').filter({ visible: true })).toBeVisible();
    await page.locator('.page__close').click();
    await expect(page.locator('.page')).toBeHidden();
    await expect(page.locator('.sheet__tab.is-active')).toHaveText(before ?? '');
    // もう一度開くと、編集の画面ではなく一覧に戻っている
    await page.locator('.sheet__tab', { hasText: '家具' }).click();
    await expect(page.locator('.page .edit__title').filter({ visible: true })).toHaveCount(0);
  });

  test('部屋のときは「部屋に追加」と出す', async ({ page }) => {
    await page.evaluate(async () => (await import('/src/core/mode.ts')).setMode('room'));
    await openFirstModel(page);
    await expect(page.locator('.tile-actions__button', { hasText: '部屋に追加' })).toBeVisible();
    await expect(page.locator('.tile-actions__button', { hasText: '背景に追加' })).toHaveCount(0);
  });

  test('家具を追加する画面に、利用者 ID を出さない', async ({ page }) => {
    await page.locator('.sheet__tab', { hasText: '家具' }).click();
    // 一覧の先頭の「追加」を押す
    await page.locator('.page .thumb__button').first().click();
    await expect(page.getByText('家具を追加').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('利用者 ID')).toHaveCount(0);
  });
});
