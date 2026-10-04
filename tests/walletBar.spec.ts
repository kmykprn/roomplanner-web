import { expect, test, type Page } from '@playwright/test';

/**
 * 「家具を追加」のいちばん上に、3D を作れる残りの回数を出す（ui/walletBar.ts）。
 * ログインしていなければ、ログインを勧める一言と［ログイン］。［回数券を買う］は買う画面ができるまで出さない
 */
async function openChooser(page: Page, auth: { anonymous: boolean }, wallet: { trialRemaining: number; credits: number; unmetered: boolean } | null): Promise<void> {
  await page.goto('/');
  await page.locator('.sheet__tab').first().waitFor();
  await page.evaluate(async (auth) => {
    const { authState } = await import('/src/platform/auth.ts');
    authState.set({ ...authState.get(), status: 'ready', ...auth });
  }, auth);
  await page.locator('.sheet__tab', { hasText: '操作' }).click();
  await page.locator('.manage__add').click();
  await page.locator('.page .thumb__button').first().click();
  await expect(page.locator('.lib__chooser')).toBeVisible();
  // 開いたときに残高を取りに行く（テストではサーバーが無いので失敗する）。そのあとで写しを入れる
  if (wallet) {
    await page.waitForTimeout(300);
    await page.evaluate(async (wallet) => {
      const { walletState } = await import('/src/core/wallet.ts');
      walletState.set({ status: 'ready', noBanner: false, ...wallet });
    }, wallet);
  }
}

const bar = (page: Page) => page.locator('.wallet-bar');

test('ログインしていると、3D を作れる残りの回数と内訳を出す', async ({ page }) => {
  await openChooser(page, { anonymous: false }, { trialRemaining: 2, credits: 1, unmetered: false });
  await expect(bar(page).locator('.wallet-bar__number')).toHaveText('3');
  await expect(bar(page).locator('.wallet-bar__detail')).toHaveText('お試し 2 回　回数券 1 回');
  // 買う画面ができるまで［回数券を買う］は出さない。0 回でなければアプリ版の案内も出さない
  await expect(page.getByRole('button', { name: '回数券を買う' })).toBeHidden();
  await expect(page.getByText('回数券はアプリ版で買えます')).toBeHidden();
});

test('Web で残りが 0 回なら、回数券はアプリ版で買えることを出す', async ({ page }) => {
  await openChooser(page, { anonymous: false }, { trialRemaining: 0, credits: 0, unmetered: false });
  await expect(bar(page).locator('.wallet-bar__number')).toHaveText('0');
  await expect(page.getByText('回数券はアプリ版で買えます')).toBeVisible();
});

test('回数を数えない設定のアカウントは、回数の代わりにそう出す', async ({ page }) => {
  await openChooser(page, { anonymous: false }, { trialRemaining: 0, credits: 0, unmetered: true });
  await expect(page.getByText('回数を数えない設定です')).toBeVisible();
  await expect(bar(page).locator('.wallet-bar__number')).toBeHidden();
  await expect(bar(page).locator('.wallet-bar__detail')).toBeHidden();
});

test('ログインしていなければ、ログインを勧める一言と［ログイン］を出し、押すとログインの案内に替わる', async ({ page }) => {
  await openChooser(page, { anonymous: true }, null);
  await expect(bar(page)).toContainText('ログインすると、家具を作れます。');
  await expect(bar(page)).toContainText('3D はお試しで 3 回作れます。');
  // 前の行の下の一言（「家具を作るには Google ログインが必要です」）は、帯と同じことを言うので出さない
  await expect(page.locator('.lib__login-hint')).toHaveCount(0);
  await bar(page).getByRole('button', { name: 'ログイン' }).click();
  await expect(page.locator('.lib__chooser .login')).toBeVisible();
});
