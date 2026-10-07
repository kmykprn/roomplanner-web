import { enterEditor } from './helpers';
import { expect, test } from '@playwright/test';

/**
 * 写真モードで家具を指で動かしても、高さは変わらない（寸法を計算する前も）。
 * 前は画面に沿って動かしていたので、画面の上へ動かすと奥へ行かずに宙に浮き、
 * 奥へ動かしたつもりで手前の家具の上に浮いていた（影が 2 つに見えた）
 */
test('寸法を計算する前でも、画面の上へドラッグすると高さを変えずに奥へ動く', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);

  const start = await page.evaluate(async () => {
    const { photoState, photoScene } = await import('/src/core/photoState.ts');
    // 写真があることにする（写真の解析は走らせない）。縦横比を決めないので、3D はキャンバス全体に描く
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    photoState.set({ backgroundStatus: 'ready', backgroundUrl: canvas.toDataURL(), backgroundAspect: null });
    // 新しい家具と同じ場所（画面の中央・下から 3 割）に、箱の家具を置く
    const position = photoScene.placementFor([0.6, 0.8, 0.6]);
    photoScene.add({ id: 'box', typeId: 'box', name: '箱', color: '#888888', size: [0.6, 0.8, 0.6], position, rotationY: 0 });
    photoScene.select(null);
    return position;
  });

  // 箱の足元（キャンバスの NDC で (0, -0.4)）より少し上を掴み、画面の上へ 120px 動かす
  const canvasBox = (await page.locator('canvas').first().boundingBox())!;
  const x = canvasBox.x + canvasBox.width / 2;
  const y = canvasBox.y + ((1 - -0.3) / 2) * canvasBox.height;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(x, y - step * 12);
  await page.mouse.up();

  const end = await page.evaluate(async () => {
    const { photoScene } = await import('/src/core/photoState.ts');
    return photoScene.state().furniture.find((item) => item.id === 'box')!.position;
  });
  // 高さは変わらず、奥（カメラから遠い側）へ動いている
  expect(end[1]).toBeCloseTo(start[1], 6);
  expect(end[2]).toBeLessThan(start[2] - 0.1);
});
