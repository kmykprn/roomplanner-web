import { expect, test } from '@playwright/test';

/**
 * 保存した背景と部屋の一覧（ui/scenePage.ts）と、編集の画面のヘッダー（ui/sceneHeader.ts）。
 * 初めての起動は新しい背景の編集から始まり、‹ で一覧へ。2 回目からは一覧から始まる。
 * タイルを押すと開いて編集へ。＋ で新しく作る。⋯ で名前を変える・複製。選択して削除
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
});

test('初めての起動は編集の画面。何もせずに戻ると、その空の背景は一覧に残らない', async ({ page }) => {
  await expect(page.locator('.scenes')).toBeHidden();
  await expect(page.locator('.scene-header__name')).toHaveText(/^背景 \d+\/\d+$/);
  await page.getByRole('button', { name: '一覧に戻る' }).click();
  await expect(page.locator('.scenes')).toBeVisible();
  await expect(page.locator('.scenes__title')).toHaveText('背景');
  await expect(page.locator('.scene-tile--add')).toHaveText(/背景の画像を選ぶ/);
  await expect(page.locator('.scene-tile__button')).toHaveCount(0);
  // 部屋のタブ。最初の起動で作られた部屋が 1 つある
  await page.locator('.scenes__tab', { hasText: '部屋' }).click();
  await expect(page.locator('.scenes__title')).toHaveText('部屋');
  await expect(page.locator('.scene-tile__button')).toHaveCount(1);
});

test('家具を置いて戻ると一覧にアイコン付きで残り、2 回目は一覧から始まり、押すと開く', async ({ page }) => {
  await page.evaluate(async () => {
    const { photoScene } = await import('/src/core/photoState.ts');
    const size: [number, number, number] = [0.5, 0.9, 0.5];
    photoScene.add({ id: 'c1', typeId: 'box', name: '椅子', color: '#ccc', size, baseSize: size, position: [0, 0, 0], rotationY: 0 });
  });
  await page.getByRole('button', { name: '一覧に戻る' }).click();
  await expect(page.locator('.scene-tile__button')).toHaveCount(1);
  // アイコンができている
  await expect.poll(() => page.locator('.scene-tile__img').first().evaluate((e) => e.style.backgroundImage)).toContain('blob:');

  await page.reload();
  await page.locator('.scenes').waitFor();
  await expect(page.locator('.scenes__title')).toHaveText('背景');
  await page.locator('.scene-tile__button').first().click();
  await expect(page.locator('.scenes')).toBeHidden();
  const count = await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().furniture.length);
  expect(count).toBe(1);
});

test('名前は編集の画面の名前からも、一覧の ⋯ からも変えられる', async ({ page }) => {
  await page.getByRole('button', { name: '名前を変える' }).click();
  await page.getByRole('textbox', { name: '名前' }).fill('リビング');
  await page.getByRole('button', { name: '決定' }).click();
  await expect(page.locator('.scene-header__name')).toHaveText('リビング');

  await page.evaluate(async () => {
    const { photoScene } = await import('/src/core/photoState.ts');
    const size: [number, number, number] = [0.5, 0.9, 0.5];
    photoScene.add({ id: 'c1', typeId: 'box', name: '椅子', color: '#ccc', size, baseSize: size, position: [0, 0, 0], rotationY: 0 });
  });
  await page.getByRole('button', { name: '一覧に戻る' }).click();
  await expect(page.locator('.scene-tile__name')).toHaveText(['リビング']);
  await page.getByRole('button', { name: 'リビング のメニュー' }).click();
  await page.locator('.bg-menu__sheet:visible').getByRole('button', { name: '名前を変える' }).click();
  await page.getByRole('textbox', { name: '名前' }).fill('寝室');
  await page.getByRole('button', { name: '決定' }).click();
  await expect(page.locator('.scene-tile__name')).toHaveText(['寝室']);
});

test('複製すると「〜のコピー」ができて開く。選択して削除で消える', async ({ page }) => {
  await page.evaluate(async () => {
    const { photoScene } = await import('/src/core/photoState.ts');
    const size: [number, number, number] = [0.5, 0.9, 0.5];
    photoScene.add({ id: 'c1', typeId: 'box', name: '椅子', color: '#ccc', size, baseSize: size, position: [0, 0, 0], rotationY: 0 });
  });
  await page.getByRole('button', { name: '一覧に戻る' }).click();
  const name = await page.locator('.scene-tile__name').first().textContent();
  await page.getByRole('button', { name: `${name} のメニュー` }).click();
  await page.locator('.bg-menu__sheet:visible').getByRole('button', { name: '複製' }).click();
  await expect(page.locator('.scenes')).toBeHidden();
  await expect(page.locator('.scene-header__name')).toHaveText(`${name} のコピー`);
  expect(await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().furniture.length)).toBe(1);

  await page.getByRole('button', { name: '一覧に戻る' }).click();
  await expect(page.locator('.scene-tile__button')).toHaveCount(2);
  const list = page.locator('.scenes');
  await list.getByRole('button', { name: '選択して削除' }).click();
  await expect(list.locator('.manage__select')).toHaveText('キャンセル');
  await expect(page.locator('.scenes__actions')).toBeVisible();
  await page.locator('.scene-tile__button').nth(1).click();
  await page.locator('.scenes__actions').getByRole('button', { name: '削除' }).click();
  const confirm = page.locator('.modal:visible');
  await expect(confirm).toContainText('この端末から完全に削除します');
  await confirm.getByRole('button', { name: '削除' }).click();
  await expect(page.locator('.scene-tile__button')).toHaveCount(1);
  await expect(list.locator('.manage__select')).toContainText('選択して削除');
});
