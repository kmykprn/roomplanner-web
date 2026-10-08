import { expect, test } from '@playwright/test';

/**
 * 開いた直後はアイコンの画面（index.html の #splash）が出て、開いてから 1.5 秒ほどで薄くなって消える。
 * JavaScript を読む前から出るように HTML に直接書いてある。指の操作は通す。
 * 開発用サーバーでは最初の読み込みが 1.5 秒を超えることがあり、出ている時間は測れないので、HTML に入っていることと消えることを見る
 */
test('アイコンの画面は HTML に入っていて、開いたあと消える', async ({ page }) => {
  const html = await (await page.request.get('/')).text();
  expect(html).toContain('id="splash"');
  expect(html).toMatch(/<div class="splash"[^>]*>\s*<img src="pwa-192x192\.png"/);
  expect(html).toContain('pointer-events: none');
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await expect(page.locator('#splash')).toHaveCount(0, { timeout: 3000 });
});
