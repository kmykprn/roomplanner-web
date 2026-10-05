import { expect, test } from '@playwright/test';

/**
 * 端末の中で切り抜く途中で iPhone が WebView ごと止めると、例外が出ないのでサーバーに切り替わらない。
 * 切り抜いている間だけ localStorage に印を残し、印が残ったまま起動したら「前回は途中で落ちた」とみなして、
 * その端末では以後サーバーに頼む（core/cutout.ts）
 */
const RUNNING_KEY = 'roomplanner.cutout.localRunning';
const DISABLED_KEY = 'roomplanner.cutout.localDisabled';

async function disabled(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(async () => {
    const { isLocalCutoutDisabled } = await import('/src/core/cutout.ts');
    return isLocalCutoutDisabled();
  });
}

test('何もなければ端末で切り抜く。切り抜き中の印が残ったまま起動したら、以後はサーバーに頼む', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  expect(await disabled(page)).toBe(false);

  // 端末で切り抜いている最中にアプリが落ちた状態（印が残っている）
  await page.evaluate((key) => localStorage.setItem(key, '1'), RUNNING_KEY);
  await page.reload();
  await page.locator('.sheet').first().waitFor();
  expect(await disabled(page)).toBe(true);
  const keys = await page.evaluate(
    ([running, off]) => ({ running: localStorage.getItem(running), off: localStorage.getItem(off) }),
    [RUNNING_KEY, DISABLED_KEY]
  );
  expect(keys.running).toBeNull();
  expect(keys.off).not.toBeNull();

  // 次の起動でも（印はもう無いが）サーバーに頼み続ける
  await page.reload();
  await page.locator('.sheet').first().waitFor();
  expect(await disabled(page)).toBe(true);
});
