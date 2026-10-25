import { expect, test, type Page } from '@playwright/test';
import { openTab , enterEditor} from './helpers';

/**
 * 操作タブのバーは、真ん中で吸い付かない。置いたときの姿（向きの 0°・大きさの 100%）へは、
 * バーの右の「0°」「100%」のボタンで戻す。すでにその値ならボタンは見えない
 */
test.describe('操作タブのバーの戻すボタン', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.sheet').first().waitFor();
    await enterEditor(page);
    await page.evaluate(async () => {
      const { activeScene } = await import('/src/core/mode.ts');
      const scene = activeScene();
      // 向きは 0° からずらし（約 29°）、大きさは 100% で置く
      scene.add({ id: 'box', typeId: 'box', name: '箱', color: '#888888', size: [0.6, 0.8, 0.6], baseSize: [0.6, 0.8, 0.6], position: [0, 0, 0], rotationY: 0.5 });
      scene.select('box');
    });
    await openTab(page, '操作');
  });

  const row = (page: Page, label: string) => page.locator('.slider-row', { hasText: label });

  /** 箱の向き（度、整数に丸める）と大きさ（実寸に対する割合） */
  async function boxState(page: Page): Promise<{ degrees: number; scale: number }> {
    return page.evaluate(async () => {
      const { activeScene } = await import('/src/core/mode.ts');
      const item = activeScene().state().furniture.find((f) => f.id === 'box')!;
      return { degrees: Math.round((item.rotationY * 180) / Math.PI), scale: item.size[0] / item.baseSize![0] };
    });
  }

  /** 「向き」のバーで、つまみを掴んで、値 degrees の位置まで動かす */
  async function dragRotationTo(page: Page, degrees: number): Promise<void> {
    const range = row(page, '向き').locator('input[type=range]');
    const box = (await range.boundingBox())!;
    const travel = box.width - 22;
    const xOf = (value: number) => box.x + 11 + ((value + 180) / 360) * travel;
    const y = box.y + box.height / 2;
    const current = Number(await range.inputValue());
    await page.mouse.move(xOf(current), y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) await page.mouse.move(xOf(current + ((degrees - current) * step) / 6), y);
    await page.mouse.up();
  }

  test('真ん中の近くでも吸い付かず、真ん中の目印も出さない', async ({ page }) => {
    await dragRotationTo(page, 12);
    const { degrees } = await boxState(page);
    expect(degrees).not.toBe(0);
    expect(Math.abs(degrees - 12)).toBeLessThanOrEqual(3);
    await expect(page.locator('.slider-row__center')).toHaveCount(0);
  });

  test('「0°」を押すと向きが 0° に戻り、ボタンは見えなくなる', async ({ page }) => {
    const reset = row(page, '向き').getByRole('button', { name: '向きを0°に戻す' });
    await expect(reset).toBeVisible();
    await reset.click();
    expect((await boxState(page)).degrees).toBe(0);
    await expect(reset).toBeHidden();
  });

  test('大きさは 100% のあいだ「100%」が見えず、［＋］で変えると出て、押すと 100% に戻る', async ({ page }) => {
    const scale = row(page, '大きさ');
    const reset = scale.getByRole('button', { name: '大きさを100%に戻す' });
    await expect(reset).toBeHidden();
    // 見えない間も場所は空けておく（行ごとに右端がそろう）
    const rightOf = async (label: string) => {
      const box = (await row(page, label).locator('.slider-row__reset').boundingBox())!;
      return box.x + box.width;
    };
    expect(Math.abs((await rightOf('大きさ')) - (await rightOf('向き')))).toBeLessThan(1);
    await scale.getByRole('button', { name: '大きくする' }).click();
    expect((await boxState(page)).scale).toBeCloseTo(1.1, 3);
    await expect(reset).toBeVisible();
    await reset.click();
    expect((await boxState(page)).scale).toBeCloseTo(1, 3);
    await expect(reset).toBeHidden();
  });

  test('どの行にも、いまの値の数字を出さない', async ({ page }) => {
    // 大きさの行は［−］［＋］と、戻す先を書いたボタン（100%）だけ。両端の目安も無い（上限も下限も無いので）
    const scale = row(page, '大きさ');
    await expect(scale.locator('.slider-row__end')).toHaveCount(0);
    await expect(scale.getByText('100%')).toHaveCount(1);
    await expect(scale.locator('.slider-row__reset')).toHaveText('100%');
    await expect(row(page, '向き').locator('.slider-row__end')).toHaveText(['-180°', '+180°']);
  });
});

/**
 * 背景の「拡大・縮小」の画面の倍率のバーにも、倍率 1 に戻す「1倍」のボタンを置く。
 * 倍率 1 のあいだは見えず、動かすと出て、押すと倍率 1 に戻る
 */
test('拡大・縮小のバーの「1倍」で、倍率 1 に戻る', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  await page.evaluate(async () => {
    const { photoState } = await import('/src/core/photoState.ts');
    // 写真があることにする（写真の解析は走らせない）
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    photoState.set({ backgroundStatus: 'ready', backgroundUrl: canvas.toDataURL(), backgroundAspect: 4 / 3 });
  });
  await page.locator('.photo-menu__button').click();
  await page.getByRole('button', { name: '拡大・縮小' }).click();
  const scaleOf = () => page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().view.scale);
  const reset = page.getByRole('button', { name: '倍率を1倍に戻す' });
  expect(await scaleOf()).toBe(1);
  await expect(reset).toBeHidden();
  const range = page.getByRole('slider', { name: '倍率を変える' });
  await range.focus();
  for (let i = 0; i < 50; i += 1) await page.keyboard.press('ArrowRight');
  expect(await scaleOf()).toBeGreaterThan(1.05);
  await expect(reset).toBeVisible();
  await reset.click();
  expect(await scaleOf()).toBeCloseTo(1, 2);
  await expect(reset).toBeHidden();
});
