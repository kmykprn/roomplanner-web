import { expect, test, type Page } from '@playwright/test';

/**
 * 写真の奥行きから、家具より手前にある物を見つけて家具を隠す（scene/depthOccluder.ts）。
 *
 * 高さ 1.3 m から水平に撮った写真で、左半分は 2 m 先に壁、右半分は 8 m 先まで何も無い、という奥行きを作る。
 * 3 m 先に幅 2 m の赤い箱を置くと、左半分は壁の奥なので隠れ、右半分は見える。切り替えを外すと両方見える
 */
async function setUp(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.sheet__tab').first().waitFor();
  await page.evaluate(async () => {
    const { photoState, photoScene } = await import('/src/core/photoState.ts');
    // 写真があることにする（写真の解析は走らせない）。奥行きと画角・傾き・撮った高さは、ここで決める
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    const width = 160, height = 120;
    const data = new Float32Array(width * height);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) data[row * width + column] = column < width / 2 ? 2 : 8;
    }
    photoState.set({
      backgroundStatus: 'ready',
      backgroundUrl: canvas.toDataURL(),
      backgroundAspect: 4 / 3,
      vfovDeg: 60,
      floorFit: { pitchDeg: 0, rollDeg: 0 },
      cameraHeight: 1.3,
      depthMap: { width, height, data },
    });
    // カメラ（z = 4）から 3 m 先
    photoScene.add({ id: 'box', typeId: 'box', name: '箱', color: '#ff0000', size: [2, 1, 0.5], position: [0, 0, 1], rotationY: 0 });
    photoScene.select(null);
  });
}

/** キャンバスの NDC の点に、赤い家具が描かれているか。画面を撮って、その点の色を見る */
async function redAt(page: Page, points: Array<[number, number]>): Promise<boolean[]> {
  // 描き終わるのを待つ
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const shot = (await canvas.screenshot()).toString('base64');
  return page.evaluate(
    async ({ shot, points, size }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${shot}`;
      await image.decode();
      const reader = document.createElement('canvas');
      reader.width = image.width;
      reader.height = image.height;
      const context = reader.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return points.map(([x, y]) => {
        const px = Math.round(((x + 1) / 2) * size.width * (image.width / size.width));
        const py = Math.round(((1 - y) / 2) * size.height * (image.height / size.height));
        const [r, g, b] = context.getImageData(px, py, 1, 1).data;
        return r > 120 && r > g * 2 && r > b * 2;
      });
    },
    { shot, points, size: { width: box.width, height: box.height } }
  );
}

/** 箱の左の部分（壁の奥）と右の部分（何も無い）の点。箱は横 ±0.47・縦 −0.82〜−0.19 あたりに写る */
const LEFT: [number, number] = [-0.25, -0.5];
const RIGHT: [number, number] = [0.25, -0.5];

test('写真の奥行きで手前にある物の奥では、家具が隠れる', async ({ page }) => {
  await setUp(page);
  expect(await redAt(page, [LEFT, RIGHT])).toEqual([false, true]);
});

test('自動で見つける切り替えを外すと、家具は隠れない', async ({ page }) => {
  await setUp(page);
  await page.evaluate(async () => {
    const { setDepthOcclusion } = await import('/src/core/photoState.ts');
    setDepthOcclusion(false);
  });
  expect(await redAt(page, [LEFT, RIGHT])).toEqual([true, true]);
});

test('切り替えは、家具より手前に表示する範囲の画面に出て、押すと切り替わる', async ({ page }) => {
  await setUp(page);
  await page.locator('.sheet__tab', { hasText: '背景' }).click();
  await page.locator('.bg-tile', { hasText: '家具より手前に' }).click();
  const toggle = page.locator('#mask-auto');
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeChecked();
  await toggle.click();
  expect(await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().depthOcclusion)).toBe(false);
  // 「戻る」で、入ったときに戻る
  await page.locator('.sub:visible button', { hasText: '戻る' }).click();
  expect(await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().depthOcclusion)).toBe(true);
});
