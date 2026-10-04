import { expect, test, type Page } from '@playwright/test';
import { openTab } from './helpers';

/**
 * 操作タブで家具を選んでいるときの画面。
 *   見出し … 左に「‹ 戻る」（押すと選ぶのをやめて一覧に戻る）、右に［＋］。家具の名前は出さない
 *   バー   … 見出し（向き・大きさ）はバーの上の行。バーを左端から始めて長く使う
 *   文字   … 見出しは本文の色・やや太字、両端の幅（-180° など）は小さな灰色。どちらも白地で 4.5:1 以上
 */
test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await page.evaluate(async () => {
    const { activeScene } = await import('/src/core/mode.ts');
    const scene = activeScene();
    scene.add({ id: 'box', typeId: 'box', name: 'サンプル 2', color: '#888888', size: [0.6, 0.8, 0.6], baseSize: [0.6, 0.8, 0.6], position: [0, 0, 0], rotationY: 0.5 });
    scene.select('box');
  });
  await openTab(page, '操作');
});

/** 白地に対するコントラスト比（WCAG の計算） */
async function contrastOf(page: Page, selector: string): Promise<number> {
  const color = await page.locator(selector).first().evaluate((el) => getComputedStyle(el).color);
  const [r, g, b] = color.match(/\d+/g)!.slice(0, 3).map(Number);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return 1.05 / (lum + 0.05);
}

test('見出しは「‹ 戻る」と［＋］で、家具の名前は出さない。「‹ 戻る」で一覧に戻る', async ({ page }) => {
  const head = page.locator('.manage__head');
  await expect(head.getByRole('button', { name: '家具の一覧に戻る' })).toHaveText('‹ 戻る');
  await expect(head.getByText('サンプル 2')).toHaveCount(0);
  await head.getByRole('button', { name: '家具の一覧に戻る' }).click();
  expect(await page.evaluate(async () => (await import('/src/core/mode.ts')).activeScene().state().selectedId)).toBeNull();
  await expect(page.locator('.manage__grid')).toBeVisible();
});

test('バーの見出しはバーの上の行にあり、幅 390px の画面でバーが 190px 以上ある', async ({ page }) => {
  const row = page.locator('.slider-row', { hasText: '向き' });
  const label = (await row.locator('.slider-row__label').boundingBox())!;
  const range = (await row.locator('input[type=range]').boundingBox())!;
  expect(label.y + label.height).toBeLessThanOrEqual(range.y + 2);
  expect(range.width).toBeGreaterThanOrEqual(190);
});

test('見出しと両端の幅は、大きさ・太さ・色で差を付け、どちらも白地で 4.5:1 以上', async ({ page }) => {
  const style = (selector: string) =>
    page.locator(selector).first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight), color: s.color };
    });
  const label = await style('.slider-row__label');
  const end = await style('.slider-row__end');
  expect(label.size).toBeGreaterThan(end.size);
  expect(label.weight).toBeGreaterThanOrEqual(600);
  expect(label.color).not.toBe(end.color);
  expect(await contrastOf(page, '.slider-row__label')).toBeGreaterThanOrEqual(4.5);
  expect(await contrastOf(page, '.slider-row__end')).toBeGreaterThanOrEqual(4.5);
});
