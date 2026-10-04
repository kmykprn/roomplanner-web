import { expect, test, type Page } from '@playwright/test';
import { openTab, openWithTwoCutouts } from './helpers';

/**
 * 操作タブの一覧（何も選んでいないとき）は、横 4 つのタイルの格子。先頭は［＋ 家具を追加］。
 * タイルを押すとその家具を選ぶ。［☑ 選択して削除］を押すとタイルにチェックを付けられ、
 * 見出しの行の［画面から削除］でまとめて外せる。［画面から削除］は［☑ 選択して削除］を押すと出て、1 つ選ぶまでは押せない（色はグレー）
 */
const placedCount = (page: Page) =>
  page.evaluate(async () => (await import('/src/core/mode.ts')).activeScene().state().furniture.length);

test.beforeEach(async ({ page }) => {
  await openWithTwoCutouts(page);
  await openTab(page, '操作');
});

test('タイルの格子で、先頭は［＋ 家具を追加］。タイルを押すとその家具を選ぶ', async ({ page }) => {
  const tiles = page.locator('.manage__grid > .manage__tile');
  await expect(tiles).toHaveCount(3);
  await expect(tiles.first()).toHaveText('家具を追加');
  // 一覧の行ごとのゴミ箱は無い
  await expect(page.getByRole('button', { name: /を画面から削除$/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'テスト 2' }).click();
  const selectedId = await page.evaluate(async () => (await import('/src/core/mode.ts')).activeScene().state().selectedId);
  expect(selectedId).toBe('test-b');
});

test('［☑ 選択して削除］でチェックを付け、［画面から削除］でまとめて外す', async ({ page }) => {
  await page.getByRole('button', { name: '選択して削除' }).click();
  const removeChecked = page.locator('.manage__top').getByRole('button', { name: '画面から削除' });
  // 押した時点で出ていて、まだ押せない
  await expect(removeChecked).toBeVisible();
  await expect(removeChecked).toBeDisabled();
  await expect(page.locator('.manage__add')).toBeDisabled();
  await page.getByRole('button', { name: 'テスト 1' }).click();
  await page.getByRole('button', { name: 'テスト 2' }).click();
  await expect(page.getByRole('button', { name: 'テスト 1' })).toHaveAttribute('aria-pressed', 'true');
  await expect(removeChecked).toBeEnabled();
  // 色は「画面から削除」と同じグレー（家具そのものを消す赤ではない）
  expect(await removeChecked.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe('rgb(104, 112, 118)');
  // チェックを付けている間は、家具を選ばない
  expect(await page.evaluate(async () => (await import('/src/core/mode.ts')).activeScene().state().selectedId)).toBeNull();

  await removeChecked.click();
  expect(await placedCount(page)).toBe(0);
  // 外したあとの一言は出さない（タイルが消えて分かる）
  await expect(page.locator('.manage .hint')).toHaveCount(0);
});

test('チェックを外すと数が減り、「キャンセル」でふだんの一覧に戻る。説明の一言は出さない', async ({ page }) => {
  await expect(page.locator('.manage .hint')).toHaveCount(0);
  await page.getByRole('button', { name: '選択して削除' }).click();
  await expect(page.locator('.manage .hint')).toHaveCount(0);
  const tile = page.getByRole('button', { name: 'テスト 1' });
  const removeChecked = page.locator('.manage__top').getByRole('button', { name: '画面から削除' });
  await tile.click();
  await expect(removeChecked).toBeEnabled();
  await expect(page.locator('.manage .hint')).toHaveCount(0);
  await tile.click();
  await expect(removeChecked).toBeDisabled();
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.locator('.manage__check')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '選択して削除' })).toBeVisible();
  expect(await placedCount(page)).toBe(2);
});

test('家具が 1 つも無いときは、［＋ 家具を追加］だけを出す（［☑ 選択して削除］も一言も出さない）', async ({ page }) => {
  await page.evaluate(async () => {
    const { activeScene } = await import('/src/core/mode.ts');
    const scene = activeScene();
    for (const item of scene.state().furniture) scene.remove(item.id);
  });
  await expect(page.locator('.manage__grid > .manage__tile')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '選択して削除' })).toHaveCount(0);
  await expect(page.locator('.manage .hint')).toHaveCount(0);
});

test('［☑ 選択して削除］は、押すと何ができるかを書いた、枠付きのボタン', async ({ page }) => {
  const select = page.locator('.manage__top').getByRole('button', { name: '選択して削除', exact: true });
  await expect(select).toBeVisible();
  // アイコン（チェックの付いた四角）が付いている
  await expect(select.locator('svg.ic')).toHaveCount(1);
  // 枠が見える（文字だけのボタンではない）
  const border = await select.evaluate((button) => getComputedStyle(button).borderTopWidth);
  expect(parseFloat(border)).toBeGreaterThanOrEqual(1);
  // 見出しの行の右端にある
  const [buttonBox, rowBox] = await Promise.all([select.boundingBox(), page.locator('.manage__top').boundingBox()]);
  expect(Math.abs(buttonBox!.x + buttonBox!.width - (rowBox!.x + rowBox!.width))).toBeLessThan(1);
});

test('置いた家具には、2D（切り抜き）か 3D（モデル）かの札が左下に付く', async ({ page }) => {
  // 用意した 2 つはどちらも切り抜き。3D を 1 つ足す
  await page.evaluate(async () => {
    const { activeScene } = await import('/src/core/mode.ts');
    const { SAMPLE_MODELS } = await import('/src/config/samples.ts');
    const chair = SAMPLE_MODELS.find((model) => model.id === 'sample-chair')!;
    const size: [number, number, number] = [0.46, 0.9, 0.5];
    activeScene().add({ id: 'solid', typeId: 'generated', name: 'モデル', color: '#ccc', size, baseSize: size, position: [0, 0, 1], rotationY: 0, modelUrl: chair.modelKey! });
    activeScene().select(null);
  });
  await expect(page.getByRole('button', { name: 'テスト 1' }).locator('.manage__form')).toHaveText('2D');
  const solid = page.getByRole('button', { name: 'モデル' });
  await expect(solid.locator('.manage__form')).toHaveText('3D');
  await expect(solid).toHaveAttribute('aria-label', 'モデル（3D）');
  // 札は左下（右上はチェックの丸）
  const [tileBox, tagBox] = await Promise.all([solid.boundingBox(), solid.locator('.manage__form').boundingBox()]);
  expect(tagBox!.x - tileBox!.x).toBeLessThan(12);
  expect(tileBox!.y + tileBox!.height - (tagBox!.y + tagBox!.height)).toBeLessThan(12);
});
