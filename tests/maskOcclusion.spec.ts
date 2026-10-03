import { expect, test, type Page } from '@playwright/test';

/**
 * 家具より手前に表示する範囲で囲った物は、家具がその物より奥にあるときだけ家具を隠す（core/maskRegions.ts）。
 *
 * 高さ 1.3 m から水平に撮った写真（灰色一色）に、写真の右寄り（横 0.5〜0.75）の範囲を指定する。
 * 範囲のいちばん下は、カメラから 3 m 先の床に写る高さにしてあるので、その物は 3 m 先に立っている。
 * カメラは z = 4 にいるので、その物の板は z = 1 にある
 */
async function setUp(page: Page, maskTop: number, maskBottom: number): Promise<void> {
  await page.goto('/');
  await page.locator('.sheet__tab').first().waitFor();
  await page.evaluate(
    async ({ maskTop, maskBottom }) => {
      const { photoState, setMaskUrl } = await import('/src/core/photoState.ts');
      // 写真は灰色一色（範囲で写真を家具の上に重ねる作りだと、家具の赤が灰色に隠れる）
      const photo = document.createElement('canvas');
      photo.width = 4;
      photo.height = 3;
      const photoContext = photo.getContext('2d')!;
      photoContext.fillStyle = '#808080';
      photoContext.fillRect(0, 0, 4, 3);
      photoState.set({
        backgroundStatus: 'ready',
        backgroundUrl: photo.toDataURL(),
        backgroundAspect: 4 / 3,
        vfovDeg: 60,
        floorFit: { pitchDeg: 0, rollDeg: 0 },
        cameraHeight: 1.3,
      });
      const mask = document.createElement('canvas');
      mask.width = 400;
      mask.height = 300;
      const maskContext = mask.getContext('2d')!;
      maskContext.fillStyle = '#fff';
      maskContext.fillRect(200, maskTop * 300, 100, (maskBottom - maskTop) * 300);
      setMaskUrl(mask.toDataURL());
    },
    { maskTop, maskBottom }
  );
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().maskRegions !== null)).toBe(true);
}

/** 赤い箱を置く。z はカメラ（z = 4）からの前後の位置 */
async function placeBox(page: Page, z: number, height = 1): Promise<void> {
  await page.evaluate(
    async ({ z, height }) => {
      const { photoScene } = await import('/src/core/photoState.ts');
      photoScene.add({ id: 'box', typeId: 'box', name: '箱', color: '#ff0000', size: [2, height, 0.5], position: [0, 0, z], rotationY: 0 });
      photoScene.select(null);
    },
    { z, height }
  );
}

/** キャンバスの NDC の点に、赤い家具が描かれているか。画面を撮って、その点の色を見る */
async function redAt(page: Page, points: Array<[number, number]>): Promise<boolean[]> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const shot = (await page.screenshot({ clip: box })).toString('base64');
  return page.evaluate(
    async ({ shot, points }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${shot}`;
      await image.decode();
      const reader = document.createElement('canvas');
      reader.width = image.width;
      reader.height = image.height;
      const context = reader.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return points.map(([x, y]) => {
        const px = Math.round(((x + 1) / 2) * (image.width - 1));
        const py = Math.round(((1 - y) / 2) * (image.height - 1));
        const [r, g, b] = context.getImageData(px, py, 1, 1).data;
        return r > 120 && r > g * 2 && r > b * 2;
      });
    },
    { shot, points }
  );
}

/** 3 m 先の床が写る高さ（写真の縦の割合）。水平に撮っているので、真ん中から 1.3 / 3 ÷ tan 30° だけ下 */
const FOOT_AT_3M = (1 + 1.3 / 3 / Math.tan(Math.PI / 6)) / 2;

test('囲った物より奥にある家具は、囲った所だけ隠れる', async ({ page }) => {
  await setUp(page, 0.4, FOOT_AT_3M);
  // 5 m 先（z = −1）。箱は横 −0.26〜0.26 に写る。右側だけが範囲（横 0〜0.5）に重なる
  await placeBox(page, -1);
  expect(await redAt(page, [[-0.15, -0.3], [0.15, -0.3]])).toEqual([true, false]);
});

test('囲った物より手前にある家具は、範囲に重なっても隠れない', async ({ page }) => {
  await setUp(page, 0.4, FOOT_AT_3M);
  // 2 m 先（z = 2）。範囲の物（3 m 先）より手前
  await placeBox(page, 2);
  expect(await redAt(page, [[-0.25, -0.5], [0.25, -0.5]])).toEqual([true, true]);
});

test('いちばん下が床に接していない範囲（窓など）は、家具がどこにあってもいつも手前に出る', async ({ page }) => {
  // 範囲は写真の上のほう（縦 0.1〜0.4）。いちばん下が地平線（縦 0.5）より上
  await setUp(page, 0.1, 0.4);
  // 2 m 先の高い箱（高さ 3 m）。上のほうが範囲に重なる
  await placeBox(page, 2, 3);
  expect(await redAt(page, [[-0.15, 0.4], [0.15, 0.4]])).toEqual([true, false]);
});

test('家具より手前に表示する範囲の画面に、自動で見つける切り替えは出さない', async ({ page }) => {
  await setUp(page, 0.4, FOOT_AT_3M);
  await page.locator('.sheet__tab', { hasText: '背景' }).click();
  await page.locator('.photo__normal').getByRole('button', { name: '編集' }).click();
  await page.getByRole('button', { name: '家具より手前に表示する範囲' }).click();
  await expect(page.locator('.mask')).toBeVisible();
  await expect(page.getByText('自動で見つける')).toHaveCount(0);
});
