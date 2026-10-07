import { expect, test } from '@playwright/test';
import { openTab , enterEditor} from './helpers';

/**
 * 操作タブの［＋ 家具を追加］を押すと、家具のページが画面全体に開く。家具を押すと「背景に追加」（部屋なら「部屋に追加」）と、見出しの右に［✎ 編集］のメニューが出る。
 * 追加で置くとページを閉じて「操作」タブを出し、「×」で閉じると元のタブに戻る
 */
test.describe('家具のページ', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.sheet').first().waitFor();
    await enterEditor(page);
  });

  /** 操作タブの［＋ 家具を追加］で、家具のページを開く */
  async function openFurniturePage(page: import('@playwright/test').Page): Promise<void> {
    await openTab(page, '操作');
    await page.locator('.manage__add').click();
    await expect(page.locator('.page')).toBeVisible();
  }

  async function openFirstModel(page: import('@playwright/test').Page): Promise<void> {
    await openFurniturePage(page);
    // 一覧の先頭は「追加」のタイルなので、その次（最初の家具）を押す
    const tile = page.locator('.page .thumb__button').nth(1);
    await tile.click();
    await expect(page.locator('.tile-actions')).toBeVisible();
  }

  test('家具を押すとメニューが出て、まだ置かれない。外側を押すと閉じる', async ({ page }) => {
    await openFirstModel(page);
    await expect(page.locator('.tile-actions__button', { hasText: '背景に追加' })).toBeVisible();
    // 主な操作は［背景に追加］1 つ。文字の付いた［編集］は見出しの右にあり、［背景に追加］より上
    await expect(page.locator('.tile-actions__button')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '編集' })).toHaveText('編集');
    const edit = (await page.getByRole('button', { name: '編集' }).boundingBox())!;
    const place = (await page.locator('.tile-actions__button').boundingBox())!;
    expect(edit.y + edit.height).toBeLessThan(place.y);
    expect(place.width).toBeGreaterThan(edit.width);
    const placed = await page.evaluate(async () => (await import('/src/core/mode.ts')).activeScene().state().furniture.length);
    expect(placed).toBe(0);
    await page.locator('.tile-actions__dim').click({ position: { x: 20, y: 20 } });
    await expect(page.locator('.tile-actions')).toBeHidden();
  });

  test('「背景に追加」で置くと、ページを閉じて、置いた家具の操作を出す', async ({ page }) => {
    await openFirstModel(page);
    await page.locator('.tile-actions__button', { hasText: '背景に追加' }).click();
    await expect(page.locator('.page')).toBeHidden();
    // 写真モードの下のパネルは操作だけ（タブが無い）。置いた家具が選ばれ、その操作が出る
    await expect(page.locator('.manage__head')).toBeVisible();
    const placed = await page.evaluate(async () => (await import('/src/core/mode.ts')).activeScene().state().furniture.length);
    expect(placed).toBe(1);
  });

  test('［編集］で編集の画面を開き、「×」で閉じると元の一覧に戻る', async ({ page }) => {
    await openFirstModel(page);
    await page.getByRole('button', { name: '編集' }).click();
    await expect(page.locator('.page .edit__title').filter({ visible: true })).toBeVisible();
    await page.locator('.page__close').click();
    await expect(page.locator('.page')).toBeHidden();
    await expect(page.locator('.manage__add')).toBeVisible();
    // もう一度開くと、編集の画面ではなく一覧に戻っている
    await openFurniturePage(page);
    await expect(page.locator('.page .edit__title').filter({ visible: true })).toHaveCount(0);
  });

  test('部屋のときは「部屋に追加」と出す', async ({ page }) => {
    await page.evaluate(async () => (await import('/src/core/mode.ts')).setMode('room'));
    await openFirstModel(page);
    await expect(page.locator('.tile-actions__button', { hasText: '部屋に追加' })).toBeVisible();
    await expect(page.locator('.tile-actions__button', { hasText: '背景に追加' })).toHaveCount(0);
  });

  test('家具を追加する画面に、利用者 ID を出さない', async ({ page }) => {
    await openFurniturePage(page);
    // 一覧の先頭の「追加」を押す
    await page.locator('.page .thumb__button').first().click();
    await expect(page.locator('.page').getByText('家具を追加').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('利用者 ID')).toHaveCount(0);
  });
});
