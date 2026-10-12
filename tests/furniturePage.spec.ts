import { expect, test } from '@playwright/test';
import { openTab , enterEditor} from './helpers';

/**
 * 操作タブの［＋ 家具を追加］を押すと、家具のページが画面全体に開く。家具を押すと「背景に追加」（部屋なら「部屋に追加」）と、見出しの右に［✎ 編集］のメニューが出る。
 * 追加で置くとページを閉じて「操作」タブを出し、下の帯の「←」で閉じると元のタブに戻る
 */
test.describe('家具のページ', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.sheet').first().waitFor();
    await enterEditor(page);
  });

  /** 操作タブの［＋ 家具を追加］で、家具のページを開く */
  async function openFurniturePage(page: import('@playwright/test').Page): Promise<void> {
    await openTab(page, '操作');
    await page.locator('.manage__add').click();
    await expect(page.locator('.page')).toBeVisible();
  }

  async function openFirstModel(page: import('@playwright/test').Page): Promise<void> {
    await openFurniturePage(page);
    const tile = page.locator('.page .thumb__button').first();
    await tile.click();
    await expect(page.locator('.tile-actions')).toBeVisible();
  }

  test('家具を押すとメニューが出て、まだ置かれない。外側を押すと閉じる', async ({ page }) => {
    await openFirstModel(page);
    await expect(page.locator('.tile-actions__button', { hasText: '背景に追加' })).toBeVisible();
    // 主な操作は［背景に追加］1 つ。文字の付いた［編集］は見出しの右にあり、［背景に追加］より上
    await expect(page.locator('.tile-actions__button')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '編集' })).toHaveText('編集');
    const edit = (await page.getByRole('button', { name: '編集' }).boundingBox())!;
    const place = (await page.locator('.tile-actions__button').boundingBox())!;
    expect(edit.y + edit.height).toBeLessThan(place.y);
    expect(place.width).toBeGreaterThan(edit.width);
    const placed = await page.evaluate(async () => (await import('/src/core/mode.ts')).activeScene().state().furniture.length);
    expect(placed).toBe(0);
    await page.locator('.tile-actions__dim').click({ position: { x: 20, y: 20 } });
    await expect(page.locator('.tile-actions')).toBeHidden();
  });

  test('「背景に追加」で置くと、ページを閉じて、置いた家具の操作を出す', async ({ page }) => {
    await openFirstModel(page);
    await page.locator('.tile-actions__button', { hasText: '背景に追加' }).click();
    await expect(page.locator('.page')).toBeHidden();
    // 写真モードの下のパネルは操作だけ（タブが無い）。置いた家具が選ばれ、その操作が出る
    await expect(page.locator('.manage__head')).toBeVisible();
    const placed = await page.evaluate(async () => (await import('/src/core/mode.ts')).activeScene().state().furniture.length);
    expect(placed).toBe(1);
  });

  test('［編集］で編集の画面を開くと、下の帯は ← だけ（＋ は無し）。← で編集だけ閉じ、もう一度 ← でページを閉じる', async ({ page }) => {
    await openFirstModel(page);
    await page.getByRole('button', { name: '編集' }).click();
    await expect(page.locator('.page .edit__title').filter({ visible: true })).toBeVisible();
    // 編集の姿に文字の「‹ 戻る」は無く、下の帯の ← で戻る。＋ は出さない
    await expect(page.locator('.page .lib__edit button', { hasText: '‹ 戻る' })).toHaveCount(0);
    await expect(page.locator('.page__back')).toBeVisible();
    await expect(page.locator('.page .fab')).toBeHidden();
    await page.locator('.page__back').click();
    await expect(page.locator('.page .edit__title').filter({ visible: true })).toHaveCount(0);
    await expect(page.locator('.page .fab')).toBeVisible();
    await page.locator('.page__back').click();
    await expect(page.locator('.page')).toBeHidden();
    await expect(page.locator('.manage__add')).toBeVisible();
    // もう一度開くと、編集の画面ではなく一覧に戻っている
    await openFurniturePage(page);
    await expect(page.locator('.page .edit__title').filter({ visible: true })).toHaveCount(0);
  });

  test('部屋のときは「部屋に追加」と出す', async ({ page }) => {
    await page.evaluate(async () => (await import('/src/core/mode.ts')).setMode('room'));
    await openFirstModel(page);
    await expect(page.locator('.tile-actions__button', { hasText: '部屋に追加' })).toBeVisible();
    await expect(page.locator('.tile-actions__button', { hasText: '背景に追加' })).toHaveCount(0);
  });

  test('家具を追加する画面に、利用者 ID を出さない', async ({ page }) => {
    await openFurniturePage(page);
    await page.locator('.page .fab').click();
    await expect(page.locator('.lib__chooser-title')).toHaveText('家具を追加');
    await expect(page.getByText('利用者 ID')).toHaveCount(0);
  });

  test('下の帯の ＋ で「家具を追加」が一覧の上に下から出て、暗い所を押すと閉じ、一覧はそのまま残る', async ({ page }) => {
    await openFurniturePage(page);
    await page.locator('.page .fab').click();
    const chooser = page.locator('.lib__chooser');
    await expect(chooser).toBeVisible();
    // 一覧（後ろ）は隠れていない。× とつまみは無い
    await expect(page.locator('.lib__normal')).toBeVisible();
    await expect(chooser.getByRole('button', { name: /閉じる|戻る/ })).toHaveCount(0);
    const r = await page.evaluate(() => {
      const sheet = document.querySelector('.lib__chooser-sheet')!.getBoundingClientRect();
      return { bottom: sheet.bottom, inner: window.innerHeight, top: sheet.top };
    });
    expect(r.bottom).toBe(r.inner);
    expect(r.top).toBeGreaterThan(r.inner / 3);
    await page.locator('.lib__chooser-dim').click({ position: { x: 10, y: 10 } });
    await expect(chooser).toBeHidden();
    await expect(page.locator('.lib__normal')).toBeVisible();
    await expect(page.locator('.page__back')).toBeVisible();
  });

  test('「家具を追加」から開くと、戻るはヘッダーの ‹（編集の画面と同じ見た目）で下の帯は無い。「新しい家具」は右下に浮かぶ白い丸（56px、黄緑の線）', async ({ page }) => {
    await openFurniturePage(page);
    const r = await page.evaluate(() => {
      const back = document.querySelector('.page__back')!;
      const b = back.getBoundingClientRect();
      const bar = document.querySelector('.page__bar')!.getBoundingClientRect();
      const title = document.querySelector('.page__title')!.getBoundingClientRect();
      const add = document.querySelector('.page .fab')!;
      const a = add.getBoundingClientRect();
      const s = getComputedStyle(add);
      return {
        backVisible: getComputedStyle(back).visibility, backLeft: b.left, backWidth: b.width, backHeight: b.height, backColor: getComputedStyle(back).color,
        backIcon: back.querySelector('.ic')!.getBoundingClientRect().width, titleCenter: (title.left + title.right) / 2, barCenter: (bar.left + bar.right) / 2,
        foot: document.querySelectorAll('.page .foot:not([hidden])').length, inner: window.innerHeight,
        addWidth: a.width, addRight: window.innerWidth - a.right, addBottom: window.innerHeight - a.bottom,
        addBackground: s.backgroundColor, addBorder: s.borderTopColor, addColor: s.color, addRadius: s.borderRadius,
        addText: add.textContent?.trim(), closeButtons: document.querySelectorAll('.page__bar button').length,
      };
    });
    // ‹ は編集の画面のヘッダーと同じ（48×44、黄緑、線は 26px）。題は真ん中
    expect(r.backVisible).toBe('visible');
    expect(r.backLeft).toBeLessThan(16);
    expect(r.backWidth).toBe(48);
    expect(r.backHeight).toBe(44);
    expect(r.backColor).toBe('rgb(110, 156, 17)');
    expect(r.backIcon).toBe(26);
    expect(Math.abs(r.titleCenter - r.barCenter)).toBeLessThan(1);
    expect(r.foot).toBe(0);
    expect(r.addWidth).toBe(56);
    expect(r.addRight).toBe(16);
    expect(r.addBottom).toBe(16);
    expect(r.addBackground).toBe('rgb(255, 255, 255)');
    expect(r.addBorder).toBe('rgb(110, 156, 17)');
    expect(r.addColor).toBe('rgb(110, 156, 17)');
    expect(r.addRadius).toBe('50%');
    expect(r.addText).toBe('');
    // 上の帯のボタンは ‹ だけ。一覧に「新しい家具」のタイルは無い
    expect(r.closeButtons).toBe(1);
    await expect(page.locator('.thumb__img.is-add')).toHaveCount(0);
  });
});
