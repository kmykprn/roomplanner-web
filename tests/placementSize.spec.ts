import { captureCamera, enterEditor, furnitureOnScreen, openTab } from './helpers';
import { expect, test, type Page } from '@playwright/test';

/**
 * 写真モードでは、置いた瞬間の家具が画面の高さの 15%〜35% に収まるように縮めて（広げて）置く。
 * 大きさは操作タブの［−］［＋］で 10% ずつ、上限も下限も無く変えられ、3 辺の比率は保つ。「100%」で置いたときの大きさに戻る
 */

async function openPhoto(page: Page): Promise<void> {
  await captureCamera(page);
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  await page.evaluate(async () => {
    const { photoState } = await import('/src/core/photoState.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    photoState.set({ backgroundStatus: 'ready', backgroundUrl: canvas.toDataURL(), backgroundAspect: 4 / 3 });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

/** 家具のページと同じ手順で置く（置くときの大きさの調整を通す） */
async function placeWithSize(page: Page, id: string, size: [number, number, number]): Promise<[number, number, number]> {
  return page.evaluate(
    async ({ id, size }) => {
      const { activeScene } = await import('/src/core/mode.ts');
      const scene = activeScene();
      const placed = scene.sizeForPlacement?.(size) ?? size;
      scene.add({ id, typeId: 'box', name: '箱', color: '#888888', size: placed, baseSize: [...placed], position: scene.placementFor(placed), rotationY: 0 });
      scene.select(id);
      return placed;
    },
    { id, size }
  );
}

async function sizeOf(page: Page, id: string): Promise<[number, number, number]> {
  return page.evaluate(async (id) => {
    const { activeScene } = await import('/src/core/mode.ts');
    return activeScene().state().furniture.find((f) => f.id === id)!.size;
  }, id);
}

test('大きな家具は画面の高さの 35% まで縮めて置き、小さな物は 15% まで広げて置く', async ({ page }) => {
  await openPhoto(page);
  const tall = await placeWithSize(page, 'tall', [2, 2.5, 1]);
  const onScreen = await furnitureOnScreen(page, 'tall');
  expect(onScreen.heightShare).toBeLessThanOrEqual(0.351);
  expect(onScreen.heightShare).toBeGreaterThan(0.3);
  // 3 辺は同じ割合で縮む
  expect(tall[0] / tall[1]).toBeCloseTo(2 / 2.5, 6);
  expect(tall[2] / tall[1]).toBeCloseTo(1 / 2.5, 6);

  const tiny = await placeWithSize(page, 'tiny', [0.05, 0.05, 0.05]);
  const tinyOnScreen = await furnitureOnScreen(page, 'tiny');
  expect(tinyOnScreen.heightShare).toBeGreaterThanOrEqual(0.149);
  expect(tiny[1]).toBeGreaterThan(0.05);
});

test('部屋モードでは実寸のまま置く', async ({ page }) => {
  await openPhoto(page);
  await page.evaluate(async () => (await import('/src/core/mode.ts')).setMode('room'));
  const placed = await placeWithSize(page, 'sofa', [1.6, 0.85, 0.85]);
  expect(placed).toEqual([1.6, 0.85, 0.85]);
});

test('［＋］で 10% ずつ大きくなり、200% を超えても止まらない。「100%」で置いたときの大きさに戻る', async ({ page }) => {
  await openPhoto(page);
  const placed = await placeWithSize(page, 'box', [0.6, 0.8, 0.6]);
  await openTab(page, '操作');
  const row = page.locator('.slider-row', { hasText: '大きさ' });
  const bigger = row.getByRole('button', { name: '大きくする' });
  const smaller = row.getByRole('button', { name: '小さくする' });
  const reset = row.getByRole('button', { name: '大きさを100%に戻す' });
  await expect(reset).toBeHidden();

  for (let i = 0; i < 10; i += 1) await bigger.click();
  const grown = await sizeOf(page, 'box');
  // 1.1 の 10 乗 ≒ 2.59 倍。前のバーの上限（200%）を超える
  expect(grown[1] / placed[1]).toBeCloseTo(1.1 ** 10, 3);
  expect(grown[0] / grown[1]).toBeCloseTo(placed[0] / placed[1], 6);
  await expect(reset).toBeVisible();

  await reset.click();
  expect((await sizeOf(page, 'box'))[1]).toBeCloseTo(placed[1], 6);
  await expect(reset).toBeHidden();

  for (let i = 0; i < 10; i += 1) await smaller.click();
  // 1.1 の −10 乗 ≒ 0.39 倍。前のバーの下限（50%）を下回る
  expect((await sizeOf(page, 'box'))[1] / placed[1]).toBeCloseTo(1.1 ** -10, 3);
});

test('［＋］を押し続けると、続けて大きくなる', async ({ page }) => {
  await openPhoto(page);
  const placed = await placeWithSize(page, 'box', [0.6, 0.8, 0.6]);
  await openTab(page, '操作');
  const bigger = page.locator('.slider-row', { hasText: '大きさ' }).getByRole('button', { name: '大きくする' });
  const box = (await bigger.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1000);
  await page.mouse.up();
  // 押した瞬間の 1 回と、400ms のあと 100ms ごとの分（1 秒で 6 回前後）
  const ratio = (await sizeOf(page, 'box'))[1] / placed[1];
  expect(ratio).toBeGreaterThan(1.1 ** 4);
  expect(ratio).toBeLessThan(1.1 ** 10);
});
