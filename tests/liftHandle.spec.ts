import { expect, test } from '@playwright/test';
import { openTab , enterEditor} from './helpers';

/**
 * 上下のつまみは、選んだ家具の真上に出す。家具そのものを指で動かしている間は隠し、離したら戻す。
 * 記号は文字（↕）ではなく、上下の三角の SVG
 */
test('家具を動かしている間は上下のつまみを隠し、離したら戻す', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  await page.evaluate(async () => {
    const { photoState, photoScene } = await import('/src/core/photoState.ts');
    // 写真があることにする（写真の解析は走らせない）。縦横比を決めないので、3D はキャンバス全体に描く
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    photoState.set({ backgroundStatus: 'ready', backgroundUrl: canvas.toDataURL(), backgroundAspect: null });
    // 新しい家具と同じ場所（画面の中央・下から 3 割）に、箱の家具を置いて選ぶ
    const size: [number, number, number] = [0.6, 0.8, 0.6];
    photoScene.add({ id: 'box', typeId: 'box', name: '箱', color: '#888888', size, position: photoScene.placementFor(size), rotationY: 0 });
    photoScene.select('box');
  });

  const handle = page.locator('.lift-handle');
  await expect(handle).toBeVisible();
  // 記号は SVG（文字ではない）
  await expect(handle.locator('svg path')).toHaveCount(1);
  await expect(handle).toHaveText('');

  // 箱の足元（キャンバスの NDC で (0, -0.4)）より少し上を掴んで動かす
  const canvasBox = (await page.locator('canvas').first().boundingBox())!;
  const x = canvasBox.x + canvasBox.width / 2;
  const y = canvasBox.y + ((1 - -0.3) / 2) * canvasBox.height;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // タップとみなす距離のうちは、まだ隠さない
  await page.mouse.move(x + 3, y);
  await expect(handle).toBeVisible();
  for (let step = 1; step <= 5; step += 1) await page.mouse.move(x + step * 12, y);
  await expect(handle).toBeHidden();
  await page.mouse.up();
  await expect(handle).toBeVisible();
});

/** 床からの高さは上下のつまみで変える。操作タブの「細かく調整」には、高さのバーを置かない */
test('操作タブに床からの高さのバーを出さない', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  await page.evaluate(async () => {
    const { activeScene } = await import('/src/core/mode.ts');
    const scene = activeScene();
    scene.add({ id: 'box', typeId: 'box', name: '箱', color: '#888888', size: [0.6, 0.8, 0.6], position: [0, 0, 0], rotationY: 0 });
    scene.select('box');
  });
  await openTab(page, '操作');
  await page.locator('.manage__more-summary').click();
  await expect(page.getByText('前後の傾き')).toBeVisible();
  await expect(page.getByText('床からの高さ')).toHaveCount(0);
});
