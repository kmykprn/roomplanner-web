import { enterEditor } from './helpers';
import { expect, test, type Page } from '@playwright/test';

/**
 * 写真を選んだあとに開き直したとき、端末に残した写真を読み戻す間も、写真があるときと同じ画面にする。
 * 前は読み戻すまでの 0.5 秒ほど「背景の画像を選ぶ」（タブのボタンと画面の真ん中）が出てから「変更」に変わり、ちらついた
 */

/** 写真を 1 枚選んで、端末に残す */
async function pickPhoto(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
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
  await expect(page.locator('.photo-menu__button')).toBeVisible();
  // 端末に残し終えるのを待つ（残す途中で消すと、あとから残って消えない）
  await expect
    .poll(() => page.evaluate(async () => (await (await import('/src/platform/backgroundStore.ts')).readBackground()) !== null), { timeout: 20000 })
    .toBe(true);
}

/**
 * 開き直し、画面の真ん中の案内（写真が無いときの［背景の画像を選ぶ］）と、写真の右上の［⋯］が出ているかを、変わるたびに順に集める。
 * 写真の読み戻しが終わる（状態が「読み戻し中」でなくなる）まで待ってから返す。
 * 決まった時間だけ集めると、遅い端末（GitHub の CI）では読み戻しが終わる前に集め終わってしまう
 */
async function reloadAndRecord(page: Page): Promise<string[]> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    const shown = (element: HTMLElement | null): boolean =>
      element !== null && !element.hidden && getComputedStyle(element).display !== 'none';
    const record = (): void => {
      const sheet = document.querySelector('.sheet');
      const empty = document.querySelector<HTMLElement>('.viewport__empty');
      const more = document.querySelector<HTMLElement>('.photo-menu__button');
      const line = `真ん中:${shown(empty) ? empty!.querySelector('button')?.textContent : '-'} ⋯:${shown(more) ? 'あり' : 'なし'}`;
      if (sheet && seen[seen.length - 1] !== line) seen.push(line);
      requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  await page.reload();
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  await expect
    .poll(() => page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().backgroundStatus), { timeout: 20000 })
    .not.toBe('restoring');
  // 状態が変わったあとの画面を、最後に 1 度集める
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => (window as unknown as { seen: string[] }).seen);
}

test('写真を選んだあとに開き直すと、読み戻す間も「背景の画像を選ぶ」が一度も出ない', async ({ page }) => {
  await pickPhoto(page);
  const seen = await reloadAndRecord(page);
  expect(seen.every((line) => line.startsWith('真ん中:-'))).toBe(true);
  expect(seen[seen.length - 1]).toBe('真ん中:- ⋯:あり');
  expect(await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().backgroundStatus)).toBe('ready');
});

test('端末に残した写真が消えていたら、「背景の画像を選ぶ」が出て、［⋯］は出ない', async ({ page }) => {
  await pickPhoto(page);
  await page.evaluate(async () => (await import('/src/platform/backgroundStore.ts')).deleteBackground());
  const seen = await reloadAndRecord(page);
  expect(seen[seen.length - 1]).toBe('真ん中:背景の画像を選ぶ ⋯:なし');
});
