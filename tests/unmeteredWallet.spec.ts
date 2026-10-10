import { expect, test, type Page } from '@playwright/test';
import { openTab , enterEditor} from './helpers';

/**
 * 回数を数えない利用者（開発者のテスト用。サーバーの config/unmetered_uids.json）は、
 * お試しも券も残っていなくても［3D モデルを作成］を押せる。ふつうの利用者は今までどおり押せない
 */

/** 2D だけの家具を足し、その編集の姿を開く。財布の写しは wallet にする */
async function openFlatOnlyEditor(page: Page, wallet: { trialRemaining: number; credits: number; unmetered: boolean }): Promise<void> {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  await page.evaluate(async (wallet) => {
    const { walletState } = await import('/src/core/wallet.ts');
    walletState.set({ status: 'ready', noBanner: false, ...wallet });
    const { modelLibrary } = await import('/src/core/modelLibrary.ts');
    const sample = modelLibrary.get().models.find((model) => model.name === 'サンプル 2')!;
    modelLibrary.set({ models: [...modelLibrary.get().models, { ...sample, id: 'flat-only', name: '切り抜きだけ', modelKey: null }] });
  }, wallet);
  await openTab(page, '操作');
  await page.locator('.manage__add').click();
  await page.locator('.page .thumb__button', { hasText: '切り抜きだけ' }).click();
  await page.locator('.tile-actions__edit').click();
  await expect(page.locator('.page .edit__title').filter({ visible: true })).toHaveText('家具の編集');
}

test('回数を数えない利用者は、残りが 0 でも［3D モデルを作成］を押せる', async ({ page }) => {
  await openFlatOnlyEditor(page, { trialRemaining: 0, credits: 0, unmetered: true });
  await expect(page.getByRole('button', { name: '3D モデルを作成' })).toBeEnabled();
  await expect(page.getByText('使い切りました')).toHaveCount(0);
});

test('ふつうの利用者は、残りが 0 なら［3D モデルを作成］を押せない', async ({ page }) => {
  await openFlatOnlyEditor(page, { trialRemaining: 0, credits: 0, unmetered: false });
  await expect(page.getByRole('button', { name: '3D モデルを作成' })).toBeDisabled();
  await expect(page.getByText('使い切りました').filter({ visible: true })).toHaveCount(1);
});
