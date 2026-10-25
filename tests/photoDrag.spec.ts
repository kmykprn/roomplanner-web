import { captureCamera, enterEditor, furnitureOnScreen } from './helpers';
import { expect, test, type Page } from '@playwright/test';

/**
 * 写真モードの家具は、カメラに正対する面の上を滑る。画面の上へ動かしても奥へは行かず、写る大きさは変わらない。
 * 前は足元の高さの水平な面を滑らせていて、上へ動かすと奥へ行って縮んだ（奥行きで大きさが変わるのが使いにくく、やめた）
 */

/** 写真があることにして、新しい家具と同じ場所に箱を置く */
async function placeBox(page: Page): Promise<void> {
  await captureCamera(page);
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  await page.evaluate(async () => {
    const { photoState, photoScene } = await import('/src/core/photoState.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    photoState.set({ backgroundStatus: 'ready', backgroundUrl: canvas.toDataURL(), backgroundAspect: null });
    const size: [number, number, number] = [0.6, 0.8, 0.6];
    photoScene.add({ id: 'box', typeId: 'box', name: '箱', color: '#888888', size, position: photoScene.placementFor(size), rotationY: 0 });
    photoScene.select(null);
  });
}

/** 箱の奥行き（z）。カメラは (0, 1.4, 4) で水平に正面（−z）を向いているので、z が変わらなければ奥へ行っていない */
async function depthOfBox(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const { photoScene } = await import('/src/core/photoState.ts');
    return photoScene.state().furniture.find((item) => item.id === 'box')!.position[2];
  });
}

test('画面の上へドラッグしても、奥へ行かず、写る大きさも変わらない', async ({ page }) => {
  await placeBox(page);
  const start = await furnitureOnScreen(page, 'box');
  const startDepth = await depthOfBox(page);

  // 箱の足元より少し上を掴み、画面の上へ 120px 動かす
  const canvasBox = (await page.locator('canvas').first().boundingBox())!;
  const x = canvasBox.x + canvasBox.width / 2;
  const y = canvasBox.y + ((1 - (start.foot[1] + 0.1)) / 2) * canvasBox.height;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(x, y - step * 12);
  await page.mouse.up();

  const end = await furnitureOnScreen(page, 'box');
  // 画面の上へ動いた
  expect(end.foot[1]).toBeGreaterThan(start.foot[1] + 0.1);
  // 画面に写る高さは変わらない（0.5% 以内）
  expect(Math.abs(end.heightShare - start.heightShare) / start.heightShare).toBeLessThan(0.005);
  // カメラに正対する面の上を動くので、奥行きは変わらない
  expect(Math.abs((await depthOfBox(page)) - startDepth)).toBeLessThan(1e-6);
});
