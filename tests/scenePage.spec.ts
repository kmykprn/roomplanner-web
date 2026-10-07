import { expect, test, type Page } from '@playwright/test';

/**
 * 保存した背景と部屋の一覧（ui/scenePage.ts）と、編集の画面のヘッダー（ui/sceneHeader.ts）。
 * アプリを開くと背景の一覧（1 つも無くても一覧）。＋ で新しく作って編集へ、‹ で一覧へ。
 * タイルを押すと開いて編集へ。⋯ で名前を変える・複製・削除
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
});

/** ＋ で新しい背景を作って編集に入り、家具を 1 つ置く */
async function createBackgroundWithChair(page: Page): Promise<void> {
  await page.locator('.scene-tile--add').click();
  await expect(page.locator('.scenes')).toBeHidden();
  await page.evaluate(async () => {
    const { photoScene } = await import('/src/core/photoState.ts');
    const size: [number, number, number] = [0.5, 0.9, 0.5];
    photoScene.add({ id: 'c1', typeId: 'box', name: '椅子', color: '#ccc', size, baseSize: size, position: [0, 0, 0], rotationY: 0 });
  });
}

test('初めての起動も一覧から。＋ で編集に入り、何もせずに戻ると、その空の背景は一覧に残らない', async ({ page }) => {
  await expect(page.locator('.scenes')).toBeVisible();
  await expect(page.locator('.scenes__title')).toHaveText('背景');
  await expect(page.locator('.scene-tile--add')).toHaveText(/新しい背景/);
  await expect(page.locator('.scene-tile__button')).toHaveCount(0);
  await page.locator('.scene-tile--add').click();
  await expect(page.locator('.scenes')).toBeHidden();
  await expect(page.locator('.scene-header__name')).toHaveText(/^背景 \d+\/\d+$/);
  await page.getByRole('button', { name: '一覧に戻る' }).click();
  await expect(page.locator('.scenes')).toBeVisible();
  await expect(page.locator('.scene-tile__button')).toHaveCount(0);
  // 右上の切り替えで部屋にしても、1 つも無ければ ＋ だけの一覧
  await page.locator('.scenes__switch-item', { hasText: '部屋' }).click();
  await expect(page.locator('.scenes__title')).toHaveText('部屋');
  await expect(page.locator('.scene-tile--add')).toHaveText(/新しい部屋/);
  await expect(page.locator('.scene-tile__button')).toHaveCount(0);
  await page.locator('.scene-tile--add').click();
  await expect(page.locator('.scene-header__name')).toHaveText(/^部屋 \d+\/\d+$/);
  await expect(page.locator('.sheet__tab', { hasText: '内装' })).toBeVisible();
});

test('家具を置いて戻ると一覧にアイコン付きで残り、2 回目も一覧から始まり、押すと開く', async ({ page }) => {
  await createBackgroundWithChair(page);
  await page.getByRole('button', { name: '一覧に戻る' }).click();
  await expect(page.locator('.scene-tile__button')).toHaveCount(1);
  await expect.poll(() => page.locator('.scene-tile__img').first().evaluate((e) => e.style.backgroundImage)).toContain('blob:');

  await page.reload();
  await page.locator('.scenes').waitFor();
  await expect(page.locator('.scenes__title')).toHaveText('背景');
  await page.locator('.scene-tile__button').first().click();
  await expect(page.locator('.scenes')).toBeHidden();
  const count = await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().furniture.length);
  expect(count).toBe(1);
});

test('名前は編集の画面の名前（鉛筆）からも、一覧の ⋯ からも変えられる', async ({ page }) => {
  await createBackgroundWithChair(page);
  await page.getByRole('button', { name: '名前を変える' }).click();
  await page.getByRole('textbox', { name: '名前' }).fill('リビング');
  await page.getByRole('button', { name: '決定' }).click();
  await expect(page.locator('.scene-header__name')).toHaveText('リビング');

  await page.getByRole('button', { name: '一覧に戻る' }).click();
  await expect(page.locator('.scene-tile__name')).toHaveText(['リビング']);
  await page.getByRole('button', { name: 'リビング のメニュー' }).click();
  await page.locator('.bg-menu__sheet:visible').getByRole('button', { name: '名前を変える' }).click();
  await page.getByRole('textbox', { name: '名前' }).fill('寝室');
  await page.getByRole('button', { name: '決定' }).click();
  await expect(page.locator('.scene-tile__name')).toHaveText(['寝室']);
});

test('複製すると「〜のコピー」ができて開く。⋯ の削除で、確認してから消える', async ({ page }) => {
  await createBackgroundWithChair(page);
  await page.getByRole('button', { name: '一覧に戻る' }).click();
  const name = (await page.locator('.scene-tile__name').first().textContent())!;
  await page.getByRole('button', { name: `${name} のメニュー` }).click();
  await page.locator('.bg-menu__sheet:visible').getByRole('button', { name: '複製' }).click();
  await expect(page.locator('.scenes')).toBeHidden();
  await expect(page.locator('.scene-header__name')).toHaveText(`${name} のコピー`);
  expect(await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().furniture.length)).toBe(1);

  await page.getByRole('button', { name: '一覧に戻る' }).click();
  await expect(page.locator('.scene-tile__button')).toHaveCount(2);
  const copyMenu = page.getByRole('button', { name: `${name} のコピー のメニュー` });
  await copyMenu.click();
  await page.locator('.bg-menu__sheet:visible').getByRole('button', { name: '削除' }).click();
  const confirm = page.locator('.modal:visible');
  await expect(confirm).toContainText(`「${name} のコピー」を削除します`);
  await expect(confirm).toContainText('この端末から完全に削除します');
  await confirm.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.locator('.scene-tile__button')).toHaveCount(2);
  await copyMenu.click();
  await page.locator('.bg-menu__sheet:visible').getByRole('button', { name: '削除' }).click();
  await page.locator('.modal:visible').getByRole('button', { name: '削除' }).click();
  await expect(page.locator('.scene-tile__button')).toHaveCount(1);
  await expect(page.locator('.scene-tile__name')).toHaveText([name]);
});

test('ヘッダーの名前は真ん中にあり、‹ の押せる範囲と重ならず、右に鉛筆がある', async ({ page }) => {
  await page.locator('.scene-tile--add').click();
  const r = await page.evaluate(() => {
    const back = document.querySelector('.scene-header__back')!.getBoundingClientRect();
    const name = document.querySelector('.scene-header__name')!.getBoundingClientRect();
    const header = document.querySelector('.header')!.getBoundingClientRect();
    return { backRight: back.right, nameLeft: name.left, nameCenter: (name.left + name.right) / 2, headerCenter: (header.left + header.right) / 2 };
  });
  expect(r.nameLeft).toBeGreaterThanOrEqual(r.backRight);
  expect(Math.abs(r.nameCenter - r.headerCenter)).toBeLessThan(1);
  await expect(page.locator('.scene-header__name .ic')).toBeVisible();
});

test('下の「家具」タブで家具のページが開き、置くボタンは出ない。「×」でホームに戻る', async ({ page }) => {
  await expect(page.locator('.scenes__tab', { hasText: 'ホーム' })).toHaveClass(/is-active/);
  await page.locator('.scenes__tab', { hasText: '家具' }).click();
  const furniture = page.getByRole('dialog', { name: '家具' });
  await expect(furniture).toBeVisible();
  // サンプルの家具を押すとメニューが出るが、置く先を開いていないので「背景に追加」は無い
  await page.locator('.page .thumb__button', { hasText: 'サンプル 1' }).click();
  await expect(page.locator('.tile-actions__name')).toBeVisible();
  await expect(page.locator('.tile-actions__button')).toBeHidden();
  await expect(page.locator('.tile-actions__edit')).toBeVisible();
  await page.locator('.tile-actions__dim').click({ position: { x: 10, y: 10 } });
  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(furniture).toBeHidden();
  await expect(page.locator('.scenes')).toBeVisible();
  // 編集の画面の「家具を追加」から開いたときは、置くボタンが戻っている
  await page.locator('.scene-tile--add').click();
  await page.locator('.manage__add').click();
  await page.locator('.page .thumb__button', { hasText: 'サンプル 1' }).click();
  await expect(page.locator('.tile-actions__button')).toHaveText('背景に追加');
});
