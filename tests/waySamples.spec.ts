import { expect, test } from '@playwright/test';

/**
 * 「家具を追加」の 2 行（2D を作る・3D モデルを作る）の左に、サンプルの椅子の見本を出す。
 * 2D の行は切り抜き、3D の行は回る 3D。3D は画面を開いている間だけ描き、閉じたら片付ける
 */
test('2D の行は切り抜き、3D の行は回る 3D の見本を出し、画面を閉じると 3D の描画を片付ける', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await page.locator('.manage__add').click();
  await page.locator('.page .thumb__button').first().click();
  const rows = page.locator('.lib__chooser .way');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('2D（切り抜き）を作る');
  await expect(rows.nth(0)).toContainText('画像から切り抜きます（数秒）');
  await expect(rows.nth(1)).toContainText('2D から立体を作ります（数分）');
  // どちらの行にも見本がある。2D は切り抜きの画像、3D は描画の枠
  await expect(rows.nth(0).locator('.preview.is-mini .preview__image')).toHaveCSS('background-image', /url\(/);
  await expect(rows.nth(0).locator('.preview__canvas')).toHaveCount(0);
  await expect(rows.nth(1).locator('.preview.is-mini .preview__canvas')).toHaveCount(1, { timeout: 15000 });
  // 押すと次へ進む行だと分かる印
  await expect(rows.nth(0).locator('.way__chevron')).toHaveText('›');
  // 「‹ 戻る」で閉じると、3D の描画の枠を片付ける
  await page.locator('.lib__chooser button', { hasText: '戻る' }).click();
  await expect(page.locator('.lib__chooser')).toBeHidden();
  await expect(page.locator('.lib__chooser .preview__canvas')).toHaveCount(0);
});
