import { expect, test } from '@playwright/test';
import { openTab , enterEditor} from './helpers';

/**
 * 端末で切り抜く途中でアプリが落ちた端末では、以後サーバーで切り抜いている（core/cutout.ts）。
 * 家具の一覧にそのことを出し、「端末でもう一度試す」を押すと印が消えて、次の写真から端末で切り抜く
 */
const DISABLED_KEY = 'roomplanner.cutout.localDisabled';

test('落ちた印がある端末では知らせが出て、「端末でもう一度試す」で印が消える', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  await openTab(page, '操作');
  await page.locator('.manage__add').click();
  // 落ちたことが無ければ出ない
  await expect(page.locator('.lib__local')).toBeHidden();

  await page.evaluate((key) => localStorage.setItem(key, '1'), DISABLED_KEY);
  await page.reload();
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  await openTab(page, '操作');
  await page.locator('.manage__add').click();
  const notice = page.locator('.lib__local');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('サーバーで切り抜いています');

  await notice.getByRole('button', { name: '端末でもう一度試す' }).click();
  await expect(notice).toBeHidden();
  const state = await page.evaluate(async (key) => {
    const { isLocalCutoutDisabled } = await import('/src/core/cutout.ts');
    return { disabled: isLocalCutoutDisabled(), key: localStorage.getItem(key) };
  }, DISABLED_KEY);
  expect(state).toEqual({ disabled: false, key: null });
});
