import { expect, test } from '@playwright/test';

/**
 * 端末の中で切り抜く途中で iPhone が WebView ごと止めると、例外が出ないのでサーバーに切り替わらない。
 * 切り抜いている間だけ localStorage に記録（写真とワーカーのメモリの大きさ）を残し、記録が残ったまま起動したら
 * 「前回は途中で落ちた」とみなして、その端末では以後サーバーに頼む。落ちた写真は「失敗」として一覧に戻し、
 * どこまで行ったか（メモリ何 MB、何をしていたか）を文言に添える（core/cutout.ts）
 */
const RUNNING_KEY = 'roomplanner.cutout.localRunning';
const DISABLED_KEY = 'roomplanner.cutout.localDisabled';

async function disabled(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(async () => {
    const { isLocalCutoutDisabled } = await import('/src/core/cutout.ts');
    return isLocalCutoutDisabled();
  });
}

test('何もなければ端末で切り抜く。切り抜き中の記録が残ったまま起動したら、以後はサーバーに頼み、落ちた写真を失敗として戻す', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  expect(await disabled(page)).toBe(false);

  // 端末で切り抜いている最中にアプリが落ちた状態（記録が残っている）
  await page.evaluate(
    (key) =>
      localStorage.setItem(key, JSON.stringify({ jobs: [{ fileName: 'chair.jpg', previewKey: null }], heapMB: 620, stage: 'running' })),
    RUNNING_KEY
  );
  await page.reload();
  await page.locator('.sheet').first().waitFor();
  expect(await disabled(page)).toBe(true);
  const failed = await page.evaluate(async () => {
    const { cutoutState } = await import('/src/core/cutout.ts');
    return cutoutState.get().jobs.map((job) => ({ fileName: job.fileName, phase: job.phase, error: job.error }));
  });
  expect(failed).toEqual([
    { fileName: 'chair.jpg', phase: 'failed', error: '端末で切り抜く途中でアプリが落ちました（メモリ 620MB まで、切り抜き中）。もう一度選ぶと、サーバーで切り抜きます' },
  ]);
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
