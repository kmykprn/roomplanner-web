import { expect, test, type Page } from '@playwright/test';
import { openTab, openWithTwoCutouts } from './helpers';

/**
 * 操作タブの一覧（何も選んでいないとき）は、横 4 つのタイルの格子。先頭は［＋ 家具を追加］。
 * タイルを押すとその家具を選ぶ。「選択」を押すとタイルにチェックを付けられ、
 * 見出しの行の「画面から削除（N 個）」でまとめて外せる（色はグレー）
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

test('「選択」でチェックを付け、「画面から削除（2 個）」でまとめて外す', async ({ page }) => {
  await page.getByRole('button', { name: '選択' }).click();
  const removeChecked = page.locator('.manage__top').getByRole('button', { name: /^画面から削除（/ });
  // 1 つも付けていない間は出さない
  await expect(removeChecked).toBeHidden();
  await expect(page.locator('.manage__add')).toBeDisabled();
  await page.getByRole('button', { name: 'テスト 1' }).click();
  await page.getByRole('button', { name: 'テスト 2' }).click();
  await expect(page.getByRole('button', { name: 'テスト 1' })).toHaveAttribute('aria-pressed', 'true');
  await expect(removeChecked).toHaveText('画面から削除（2 個）');
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
  await page.getByRole('button', { name: '選択' }).click();
  await expect(page.locator('.manage .hint')).toHaveCount(0);
  const tile = page.getByRole('button', { name: 'テスト 1' });
  const removeChecked = page.locator('.manage__top').getByRole('button', { name: /^画面から削除（/ });
  await tile.click();
  await expect(removeChecked).toHaveText('画面から削除（1 個）');
  await expect(page.locator('.manage .hint')).toHaveCount(0);
  await tile.click();
  await expect(removeChecked).toBeHidden();
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.locator('.manage__check')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '選択' })).toBeVisible();
  expect(await placedCount(page)).toBe(2);
});

test('家具が 1 つも無いときは、［＋ 家具を追加］だけを出す（「選択」も一言も出さない）', async ({ page }) => {
  await page.evaluate(async () => {
    const { activeScene } = await import('/src/core/mode.ts');
    const scene = activeScene();
    for (const item of scene.state().furniture) scene.remove(item.id);
  });
  await expect(page.locator('.manage__grid > .manage__tile')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '選択' })).toHaveCount(0);
  await expect(page.locator('.manage .hint')).toHaveCount(0);
});
