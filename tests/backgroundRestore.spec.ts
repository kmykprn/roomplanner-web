import { expect, test, type Page } from '@playwright/test';

/**
 * 写真を選んだあとに開き直したとき、端末に残した写真を読み戻す間も、写真があるときと同じ画面にする。
 * 前は読み戻すまでの 0.5 秒ほど「背景の画像を選ぶ」（タブのボタンと画面の真ん中）が出てから「変更」に変わり、ちらついた
 */

/** 写真を 1 枚選んで、端末に残す */
async function pickPhoto(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.sheet__tab').first().waitFor();
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 900;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#c9a77c';
    context.fillRect(0, 0, 1200, 900);
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg'));
    const { setBackground, setFramingPhoto } = await import('/src/core/photoState.ts');
    await setBackground(new File([blob], 'room.jpg', { type: 'image/jpeg' }));
    setFramingPhoto(false);
  });
  await expect(page.locator('.bg-row__pick')).toHaveText('背景の画像を変更');
  // 端末に残し終えるのを待つ（残す途中で消すと、あとから残って消えない）
  await expect
    .poll(() => page.evaluate(async () => (await (await import('/src/platform/backgroundStore.ts')).readBackground()) !== null), { timeout: 20000 })
    .toBe(true);
}

/**
 * 開き直し、タブのボタンの文言と、画面の真ん中のボタンの文言を、変わるたびに順に集める。
 * 写真の読み戻しが終わる（状態が「読み戻し中」でなくなる）まで待ってから返す。
 * 決まった時間だけ集めると、遅い端末（GitHub の CI）では読み戻しが終わる前に集め終わってしまう
 */
async function reloadAndRecord(page: Page): Promise<string[]> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    const record = (): void => {
      const pick = document.querySelector('.bg-row__pick')?.textContent;
      const empty = document.querySelector<HTMLElement>('.viewport__empty');
      const emptyShown = empty !== null && !empty.hidden && getComputedStyle(empty).display !== 'none';
      const line = `タブ:${pick ?? '-'} 真ん中:${emptyShown ? empty.querySelector('button')?.textContent : '-'}`;
      if (pick !== undefined && seen[seen.length - 1] !== line) seen.push(line);
      requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  await page.reload();
  await page.locator('.sheet__tab').first().waitFor();
  await expect
    .poll(() => page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().backgroundStatus), { timeout: 20000 })
    .not.toBe('restoring');
  // 状態が変わったあとの画面を、最後に 1 度集める
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => (window as unknown as { seen: string[] }).seen);
}

test('写真を選んだあとに開き直すと、最初から「背景の画像を変更」が出て、文言が変わらない', async ({ page }) => {
  await pickPhoto(page);
  expect(await reloadAndRecord(page)).toEqual(['タブ:背景の画像を変更 真ん中:-']);
  expect(await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().backgroundStatus)).toBe('ready');
  await expect(page.locator('.bg-row__edit')).toBeVisible();
});

test('端末に残した写真が消えていたら、「背景の画像を選ぶ」に変わる', async ({ page }) => {
  await pickPhoto(page);
  await page.evaluate(async () => (await import('/src/platform/backgroundStore.ts')).deleteBackground());
  const seen = await reloadAndRecord(page);
  expect(seen[seen.length - 1]).toBe('タブ:背景の画像を選ぶ 真ん中:背景の画像を選ぶ');
  await expect(page.locator('.bg-row__edit')).toBeHidden();
});
