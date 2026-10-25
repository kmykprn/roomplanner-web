import { captureCamera, enterEditor, furnitureOnScreen } from './helpers';
import { expect, test, type Page } from '@playwright/test';

/**
 * 写真モードで家具を画面の上へ動かすと奥へ行く（足元の高さの水平な面を滑る）。
 * ただし写る大きさは変えない。動かす前後で画面に写る高さが同じになるよう、3D の大きさのほうを変える（core/apparentSize.ts）。
 * 前は奥へ行くと遠近でそのまま縮んでいた
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
    photoScene.add({ id: 'box', typeId: 'box', name: '箱', color: '#888888', size, baseSize: [...size], position: photoScene.placementFor(size), rotationY: 0 });
    photoScene.select(null);
  });
}

async function boxState(page: Page): Promise<{ position: [number, number, number]; size: [number, number, number]; baseSize: [number, number, number] }> {
  return page.evaluate(async () => {
    const { photoScene } = await import('/src/core/photoState.ts');
    const item = photoScene.state().furniture.find((entry) => entry.id === 'box')!;
    return { position: item.position, size: item.size, baseSize: item.baseSize! };
  });
}

test('画面の上へドラッグすると奥へ行くが、写る大きさは変わらない', async ({ page }) => {
  await placeBox(page);
  const start = await furnitureOnScreen(page, 'box');
  const before = await boxState(page);

  // 箱の足元より少し上を掴み、画面の上へ 120px 動かす
  const canvasBox = (await page.locator('canvas').first().boundingBox())!;
  const x = canvasBox.x + canvasBox.width / 2;
  const y = canvasBox.y + ((1 - (start.foot[1] + 0.1)) / 2) * canvasBox.height;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(x, y - step * 12);
  await page.mouse.up();

  const end = await furnitureOnScreen(page, 'box');
  const after = await boxState(page);
  // 高さは変わらず、奥（カメラから遠い側）へ動いている
  expect(after.position[1]).toBeCloseTo(before.position[1], 6);
  expect(after.position[2]).toBeLessThan(before.position[2] - 0.1);
  // 画面に写る高さは変わらない（0.5% 以内）。そのぶん 3D の大きさは大きくなっている
  expect(Math.abs(end.heightShare - start.heightShare) / start.heightShare).toBeLessThan(0.005);
  expect(after.size[1]).toBeGreaterThan(before.size[1] * 1.05);
  // 比率は保ち、「100%」の戻り先も同じ割合で変わる
  expect(after.size[0] / after.size[1]).toBeCloseTo(before.size[0] / before.size[1], 6);
  expect(after.baseSize[1] / before.baseSize[1]).toBeCloseTo(after.size[1] / before.size[1], 6);
});
