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

test('下の「家具」タブの家具のページは「家具を追加」と同じ。「背景に追加」で最後に開いていた背景に置いて編集へ', async ({ page }) => {
  await createBackgroundWithChair(page);
  await page.locator('.scene-header__back').click();
  await expect(page.locator('.scene-tile__button')).toHaveCount(1);
  const name = await page.locator('.scene-tile__name').textContent();
  await expect(page.locator('.scenes__tab', { hasText: 'ホーム' })).toHaveClass(/is-active/);
  await page.locator('.scenes__tab', { hasText: '家具' }).click();
  const furniture = page.getByRole('dialog', { name: '家具' });
  await expect(furniture).toBeVisible();
  // サンプルの家具を押すと、編集の画面の「家具を追加」と同じメニュー（置く形と「背景に追加」付き）
  await page.locator('.page .thumb__button', { hasText: 'サンプル 1' }).click();
  await expect(page.getByRole('group', { name: '置く形' })).toBeVisible();
  await expect(page.locator('.tile-actions__button')).toHaveText('背景に追加');
  await page.locator('.tile-actions__button').click();
  // その背景を開いて置き、編集の画面に移る
  await expect(furniture).toBeHidden();
  await expect(page.locator('.scenes')).toBeHidden();
  await expect(page.locator('.scene-header__name')).toHaveText(name!);
  const names = await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().furniture.map((f) => f.name));
  expect(names).toEqual(['椅子', 'サンプル 1']);
  // 置いた家具を選んだ状態（操作の行）になっている
  await expect(page.getByRole('button', { name: '画面から削除' })).toBeVisible();
  // 「×」で閉じたときはホームのまま
  await page.locator('.scene-header__back').click();
  await page.locator('.scenes__tab', { hasText: '家具' }).click();
  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(furniture).toBeHidden();
  await expect(page.locator('.scenes')).toBeVisible();
});

test('部屋を選んで「家具」タブから置くと「部屋に追加」。部屋が 1 つも無ければ新しく作ってそこに置く', async ({ page }) => {
  await page.locator('.scenes__switch-item', { hasText: '部屋' }).click();
  await expect(page.locator('.scene-tile__button')).toHaveCount(0);
  await page.locator('.scenes__tab', { hasText: '家具' }).click();
  await page.locator('.page .thumb__button', { hasText: 'サンプル 1' }).click();
  await expect(page.locator('.tile-actions__button')).toHaveText('部屋に追加');
  await page.locator('.tile-actions__button').click();
  await expect(page.locator('.scenes')).toBeHidden();
  await expect(page.locator('.scene-header__name')).toHaveText(/^部屋 \d+\/\d+$/);
  const names = await page.evaluate(async () => (await import('/src/core/appState.ts')).appState.get().furniture.map((f) => f.name));
  expect(names).toEqual(['サンプル 1']);
  await page.locator('.scene-header__back').click();
  await expect(page.locator('.scenes__switch-item', { hasText: '部屋' })).toHaveClass(/is-active/);
  await expect(page.locator('.scene-tile__button')).toHaveCount(1);
});

test('追加のタイルは、点線の枠の中が ＋ だけで、名前は枠の下。地は白で、文字は濃い灰色', async ({ page }) => {
  const r = await page.evaluate(() => {
    const box = document.querySelector('.scene-tile__add-box')!;
    const name = document.querySelector('.scene-tile__add-name')!;
    const bs = getComputedStyle(box);
    return {
      boxBottom: box.getBoundingClientRect().bottom, nameTop: name.getBoundingClientRect().top,
      boxBackground: bs.backgroundColor, boxBorder: bs.borderTopStyle, nameColor: getComputedStyle(name).color, nameText: name.textContent,
    };
  });
  expect(r.nameText).toBe('新しい背景');
  expect(r.nameTop).toBeGreaterThanOrEqual(r.boxBottom);
  expect(r.boxBackground).toBe('rgb(255, 255, 255)');
  expect(r.boxBorder).toBe('dashed');
  expect(r.nameColor).toBe('rgb(17, 24, 28)');
  // 編集の画面の「家具を追加」と、家具のページの「新しい家具」も同じ地と文字の色
  await page.locator('.scene-tile--add').click();
  const manage = await page.locator('.manage__add').evaluate((el) => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, border: getComputedStyle(el).borderTopStyle }));
  expect(manage).toEqual({ background: 'rgb(255, 255, 255)', color: 'rgb(17, 24, 28)', border: 'dashed' });
  await page.locator('.manage__add').click();
  const lib = await page.locator('.thumb__img.is-add').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(lib).toBe('rgb(255, 255, 255)');
});
