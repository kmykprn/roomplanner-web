import { expect, test, type Page } from '@playwright/test';
import { openTab , enterEditor} from './helpers';

/**
 * 「家具を追加」のいちばん上に、3D を作れる残りの回数を出す（ui/walletBar.ts）。
 * 回数はお試しと回数券を合わせて「3D 作成　残り N 回」。右に金色の枠の［購入］（押すと回数券の一覧）。
 * ログインしていなければ、お試しの回数と［ログイン］
 */
async function openChooser(page: Page, auth: { anonymous: boolean }, wallet: { trialRemaining: number; credits: number; unmetered: boolean } | null): Promise<void> {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  await page.evaluate(async (auth) => {
    const { authState } = await import('/src/platform/auth.ts');
    authState.set({ ...authState.get(), status: 'ready', ...auth });
  }, auth);
  await openTab(page, '操作');
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

test('ログインしていると「3D 作成　残り N 回」（お試しと回数券の合計）と、右に［購入］を出す', async ({ page }) => {
  await openChooser(page, { anonymous: false }, { trialRemaining: 2, credits: 1, unmetered: false });
  await expect(bar(page).locator('.wallet-bar__count')).toHaveText(/3D 作成\s*残り\s*3\s*回/);
  const buy = bar(page).getByRole('button', { name: '購入' });
  await expect(buy).toBeVisible();
  // ［購入］は回数の右
  const [countBox, buyBox] = await Promise.all([bar(page).locator('.wallet-bar__count').boundingBox(), buy.boundingBox()]);
  expect(buyBox!.x).toBeGreaterThan(countBox!.x + countBox!.width);
  // 内訳は出さない
  await expect(bar(page)).not.toContainText('お試し');
});

test('残りが 0 回でも［購入］を出し、押すと回数券の一覧が出る', async ({ page }) => {
  await openChooser(page, { anonymous: false }, { trialRemaining: 0, credits: 0, unmetered: false });
  await expect(bar(page).locator('.wallet-bar__number')).toHaveText('0');
  await bar(page).getByRole('button', { name: '購入' }).click();
  const sheet = page.getByRole('dialog', { name: '回数券' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.ticket-sheet__row')).toHaveText([/10 回\s*120 円/, /30 回\s*300 円/, /80 回\s*600 円/]);
  await expect(sheet).toContainText('購入は準備中です。');
  await sheet.getByRole('button', { name: 'とじる' }).click();
  await expect(sheet).toBeHidden();
});

test('回数を数えない設定のアカウントは「3D 作成　回数無制限」で、［購入］は出さない', async ({ page }) => {
  await openChooser(page, { anonymous: false }, { trialRemaining: 0, credits: 0, unmetered: true });
  await expect(bar(page).locator('.wallet-bar__count')).toHaveText(/^3D 作成\s*回数無制限$/, { useInnerText: true });
  await expect(bar(page).getByRole('button', { name: '購入' })).toBeHidden();
});

test('ログインしていなければ、お試しの回数と［ログイン］を出し、押すとログインの案内に替わる', async ({ page }) => {
  await openChooser(page, { anonymous: true }, null);
  await expect(bar(page).locator('.wallet-bar__count')).toHaveText(/3D 作成\s*残り\s*3\s*回/);
  await expect(bar(page).getByRole('button', { name: '購入' })).toBeHidden();
  // 前の行の下の一言（「家具を作るには Google ログインが必要です」）は、帯と同じことを言うので出さない
  await expect(page.locator('.lib__login-hint')).toHaveCount(0);
  await bar(page).getByRole('button', { name: 'ログイン' }).click();
  await expect(page.locator('.lib__chooser .login')).toBeVisible();
});
