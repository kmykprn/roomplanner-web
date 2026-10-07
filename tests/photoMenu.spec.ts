import { enterEditor } from './helpers';
import { expect, test, type Page } from '@playwright/test';

/**
 * 写真モードには「背景」タブを置かず、写真の右上の［⋯］から背景の操作を選ぶ（ui/photoMenu.ts）。
 * ［⋯］は写真があるときだけ出す。押すとメニューが下から出て、選んだ調整の画面は下のパネルに出る。
 * 終えると下のパネルは置いた家具の一覧に戻る
 */
async function open(page: Page, withPhoto: boolean): Promise<void> {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
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
}

const more = (page: Page) => page.locator('.photo-menu__button');
const menu = (page: Page) => page.getByRole('dialog', { name: '背景の編集' });

test('写真が無いときは［⋯］を出さず、写真があるときだけ写真の右上に出す', async ({ page }) => {
  await open(page, false);
  await expect(more(page)).toBeHidden();
  // 写真を選ぶのは画面の真ん中の案内
  await expect(page.locator('.viewport__empty').getByRole('button', { name: '背景の画像を選ぶ' })).toBeVisible();
  await open(page, true);
  await expect(more(page)).toBeVisible();
  const [button, viewport] = await Promise.all([more(page).boundingBox(), page.locator('.viewport').boundingBox()]);
  // 右上の角の近く
  expect(viewport!.x + viewport!.width - (button!.x + button!.width)).toBeLessThan(20);
  expect(button!.y - viewport!.y).toBeLessThan(20);
  // 部屋モードでは出さない
  await page.evaluate(async () => (await import('/src/core/mode.ts')).setMode('room'));
  await expect(more(page)).toBeHidden();
});

test('写真モードの下のパネルにはタブが無く、置いた家具の一覧を出す', async ({ page }) => {
  await open(page, true);
  await expect(page.locator('.sheet__tabs')).toBeHidden();
  await expect(page.locator('.manage__add')).toBeVisible();
  await expect(page.getByRole('button', { name: '背景の画像を変更' })).toHaveCount(0);
});

test('［⋯］を押すとメニューが出て、選んだ調整の画面が下のパネルに出る。終えると一覧に戻る', async ({ page }) => {
  await open(page, true);
  await more(page).click();
  await expect(menu(page).getByRole('button')).toHaveText(['背景の画像を変更', '拡大・縮小', '寸法', '家具を隠す範囲', '背景の画像を外す']);
  await menu(page).getByRole('button', { name: '寸法' }).click();
  await expect(menu(page)).toBeHidden();
  expect(await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().isScaling)).toBe(true);
  // 調整の画面に入っている間は、［⋯］と一覧を出さない
  await expect(more(page)).toBeHidden();
  await expect(page.locator('.manage__add')).toHaveCount(0);
  await page.locator('.sub:visible button', { hasText: '戻る' }).click();
  await expect(page.locator('.manage__add')).toBeVisible();
  await expect(more(page)).toBeVisible();
});

test('メニューの外を押すと閉じ、「背景の画像を外す」で背景が無くなり［⋯］も消える', async ({ page }) => {
  await open(page, true);
  await more(page).click();
  await page.locator('.photo-menu .bg-menu__dim').click({ position: { x: 20, y: 20 } });
  await expect(menu(page)).toBeHidden();
  await more(page).click();
  await menu(page).getByRole('button', { name: '背景の画像を外す' }).click();
  await expect(menu(page)).toBeHidden();
  expect(await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().backgroundStatus)).not.toBe('ready');
  await expect(more(page)).toBeHidden();
});

test('調整の画面の途中で部屋に切り替えたら、その画面を終える（1 本指が取られたままにしない）', async ({ page }) => {
  await open(page, true);
  await more(page).click();
  await menu(page).getByRole('button', { name: '家具を隠す範囲' }).click();
  await page.evaluate(async () => (await import('/src/core/mode.ts')).setMode('room'));
  expect(await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().isMasking)).toBe(false);
});
