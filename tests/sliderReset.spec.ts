import { expect, test, type Page } from '@playwright/test';

/**
 * 操作タブのバーは、真ん中で吸い付かない。置いたときの姿（向きの 0°・大きさの 100%）へは、
 * バーの右の「0°」「100%」のボタンで戻す。すでにその値ならボタンは見えない
 */
test.describe('操作タブのバーの戻すボタン', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.sheet__tab').first().waitFor();
    await page.evaluate(async () => {
      const { activeScene } = await import('/src/core/mode.ts');
      const scene = activeScene();
      // 向きは 0° からずらし（約 29°）、大きさは 100% で置く
      scene.add({ id: 'box', typeId: 'box', name: '箱', color: '#888888', size: [0.6, 0.8, 0.6], baseSize: [0.6, 0.8, 0.6], position: [0, 0, 0], rotationY: 0.5 });
      scene.select('box');
    });
    await page.locator('.sheet__tab', { hasText: '操作' }).click();
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

  test('「0°」を押すと向きが 0° に戻り、ボタンは見えなくなる。ひとつ戻すで押す前に戻る', async ({ page }) => {
    const reset = row(page, '向き').getByRole('button', { name: '向きを0°に戻す' });
    await expect(reset).toBeVisible();
    await reset.click();
    expect((await boxState(page)).degrees).toBe(0);
    await expect(reset).toBeHidden();
    await page.getByRole('button', { name: 'ひとつ戻す' }).click();
    expect((await boxState(page)).degrees).toBe(29);
  });

  test('大きさは 100% のあいだ「100%」が見えず、動かすと出て、押すと 100% に戻る', async ({ page }) => {
    const reset = row(page, '大きさ').getByRole('button', { name: '大きさを100%に戻す' });
    await expect(reset).toBeHidden();
    // 見えない間も場所は空けておく（行ごとにバーの長さが変わらない）
    const widthOf = async (label: string) => (await row(page, label).locator('input[type=range]').boundingBox())!.width;
    expect(Math.abs((await widthOf('大きさ')) - (await widthOf('向き')))).toBeLessThan(1);
    const range = row(page, '大きさ').locator('input[type=range]');
    await range.focus();
    for (let i = 0; i < 20; i += 1) await page.keyboard.press('ArrowRight');
    expect((await boxState(page)).scale).toBeGreaterThan(1.01);
    await expect(reset).toBeVisible();
    await reset.click();
    expect((await boxState(page)).scale).toBeCloseTo(1, 3);
    await expect(reset).toBeHidden();
  });

  test('どのバーにも、いまの値の数字を出さない', async ({ page }) => {
    // 両端の 50% / 200% と、戻す先を書いたボタン（100%）だけ
    const scale = row(page, '大きさ');
    await expect(scale.locator('.slider-row__end')).toHaveText(['50%', '200%']);
    await expect(scale.getByText('100%')).toHaveCount(1);
    await expect(scale.locator('.slider-row__reset')).toHaveText('100%');
  });
});
