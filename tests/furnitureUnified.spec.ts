import { expect, test, type Page } from '@playwright/test';
import { openTab , enterEditor} from './helpers';

/**
 * 家具のページの一覧では、2D と 3D を両方持つ家具も 1 枚のタイルにする。3D も持つ家具には右下に立方体の印。
 * 押すと出るメニューで置く形（2D / 3D）を選ぶ。大きな見本は、3D なら回る 3D、2D なら揺れる切り抜き。
 * 2D だけの家具は 2D を選んだ状態で、3D の側に点線の「3D モデルを作る」を出す
 */

async function openFurniturePage(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  await openTab(page, '操作');
  await page.locator('.manage__add').click();
  await expect(page.locator('.page')).toBeVisible();
}

/** 置いた家具の、3D と切り抜きのありか */
const placedForms = (page: Page) =>
  page.evaluate(async () => {
    const [item] = (await import('/src/core/mode.ts')).activeScene().state().furniture;
    return { model: Boolean(item?.modelUrl), image: Boolean(item?.imageUrl) };
  });

test('2D と 3D を両方持つサンプルも、一覧では 1 枚ずつ。3D の印が付き、絞り込みは無い', async ({ page }) => {
  await openFurniturePage(page);
  // 先頭の「追加」と、サンプル 2 つ
  await expect(page.locator('.page .thumb__button')).toHaveCount(3);
  await expect(page.locator('.page .thumb__button', { hasText: 'サンプル 1' })).toHaveCount(1);
  await expect(page.locator('.page .thumb__button', { hasText: 'サンプル 1' }).locator('.solid-mark')).toBeVisible();
  await expect(page.getByRole('group', { name: '家具の絞り込み' })).toHaveCount(0);
});

test('メニューでは最初に 3D を選んでいて、回る 3D の見本が出る。2D を選ぶと切り抜きで置ける', async ({ page }) => {
  await openFurniturePage(page);
  await page.locator('.page .thumb__button', { hasText: 'サンプル 1' }).click();
  const options = page.getByRole('group', { name: '置く形' });
  await expect(options).toBeVisible();
  await expect(options.getByRole('button', { name: /3D/ })).toHaveAttribute('aria-pressed', 'true');
  // 3D が読み込めたら、描画の枠が出る
  await expect(page.locator('.preview.is-solid .preview__canvas')).toHaveCount(1, { timeout: 15000 });
  await options.getByRole('button', { name: /2D/ }).click();
  await expect(options.getByRole('button', { name: /2D/ })).toHaveAttribute('aria-pressed', 'true');
  // 2D に切り替えると、3D の描画の枠は片付ける
  await expect(page.locator('.preview__canvas')).toHaveCount(0);
  await page.locator('.tile-actions__button', { hasText: '背景に追加' }).click();
  expect(await placedForms(page)).toEqual({ model: false, image: true });
});

test('3D のまま追加すると 3D で置き、メニューを閉じると 3D の描画の枠も片付ける', async ({ page }) => {
  await openFurniturePage(page);
  await page.locator('.page .thumb__button', { hasText: 'サンプル 1' }).click();
  await expect(page.locator('.preview__canvas')).toHaveCount(1, { timeout: 15000 });
  await page.locator('.tile-actions__button', { hasText: '背景に追加' }).click();
  expect(await placedForms(page)).toEqual({ model: true, image: false });
  await expect(page.locator('.preview__canvas')).toHaveCount(0);
});

test('2D だけの家具は 2D を選んだ状態で、3D の側は点線の「3D モデルを作る」。押すと編集の姿の 3D を作る欄を開く', async ({ page }) => {
  await openFurniturePage(page);
  await page.evaluate(async () => {
    const { modelLibrary } = await import('/src/core/modelLibrary.ts');
    const sample = modelLibrary.get().models.find((model) => model.name === 'サンプル 2')!;
    modelLibrary.set({ models: [...modelLibrary.get().models, { ...sample, id: 'flat-only', name: '切り抜きだけ', modelKey: null }] });
  });
  const tile = page.locator('.page .thumb__button', { hasText: '切り抜きだけ' });
  await expect(tile.locator('.solid-mark')).toBeHidden();
  await tile.click();
  const options = page.getByRole('group', { name: '置く形' });
  await expect(options).toBeVisible();
  await expect(options.getByRole('button', { name: /^2D/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(options.getByRole('button', { name: /^3D 立体/ })).toBeHidden();
  const make = options.getByRole('button', { name: '3D モデルを作る' });
  await expect(make).toBeVisible();
  // 「背景に追加」と同じ塗りにしない（主の操作と見分けるため）。点線の枠
  const style = await make.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopStyle, background: s.backgroundColor };
  });
  expect(style.border).toBe('dashed');
  expect(style.background).not.toBe('rgb(110, 156, 17)');
  await expect(page.locator('.tile-actions__button')).toBeVisible();
  await make.click();
  await expect(page.locator('.page .edit__title').filter({ visible: true })).toHaveText('家具の編集');
  await expect(page.getByRole('button', { name: '3D モデルを作成' })).toBeVisible();
});

test('編集の姿の削除は、2D と 3D をまとめて家具ごと消す', async ({ page }) => {
  await openFurniturePage(page);
  await page.locator('.page .thumb__button', { hasText: 'サンプル 1' }).click();
  await page.getByRole('button', { name: '編集' }).click();
  await page.getByRole('button', { name: 'この家具を完全に削除' }).click();
  await page.getByRole('button', { name: '削除', exact: true }).click();
  await expect(page.locator('.page .thumb__button', { hasText: 'サンプル 1' })).toHaveCount(0);
  const left = await page.evaluate(async () =>
    (await import('/src/core/modelLibrary.ts')).modelLibrary.get().models.some((model) => model.name === 'サンプル 1')
  );
  expect(left).toBe(false);
});
