import { expect, test, type Page } from '@playwright/test';
import { openTab, openWithTwoCutouts } from './helpers';

/**
 * 操作タブの一覧（何も選んでいないとき）は、横 4 つのタイルの格子。先頭は［＋ 家具を追加］。
 * タイルを押すとその家具を選ぶ。「選択」を押すとタイルにチェックを付けられ、
 * 下の段の「画面から削除（N 個）」でまとめて外せる（色はグレー。ひとつ戻すでまとめて戻る）
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

test('「選択」でチェックを付け、「画面から削除（2 個）」でまとめて外す。ひとつ戻すでまとめて戻る', async ({ page }) => {
  await page.getByRole('button', { name: '選択' }).click();
  const removeChecked = page.locator('.manage__bar').getByRole('button', { name: /^画面から削除（/ });
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
  await expect(page.getByText('2 個の家具を画面から削除しました。「家具を追加」の中には残っています')).toBeVisible();
  await page.getByRole('button', { name: 'ひとつ戻す' }).click();
  expect(await placedCount(page)).toBe(2);
});

test('チェックを外すと数が減り、「キャンセル」でふだんの一覧に戻る', async ({ page }) => {
  await page.getByRole('button', { name: '選択' }).click();
  const tile = page.getByRole('button', { name: 'テスト 1' });
  await tile.click();
  await expect(page.getByText('1 個選んでいます。')).toBeVisible();
  await tile.click();
  await expect(page.getByText('画面から削除する家具を押してください。')).toBeVisible();
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.locator('.manage__check')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ひとつ戻す' })).toBeVisible();
  expect(await placedCount(page)).toBe(2);
});
