import { enterEditor } from './helpers';
import { expect, test, type Page } from '@playwright/test';

/**
 * 家具を隠す範囲で囲った所は、写真のその部分を家具の上に重ねる。家具は写真の奥行きに合わせて置かないので、
 * 家具がどこにあっても（カメラの近くでも遠くでも）、囲った所に重なる部分だけがいつも隠れる。
 * 隠すのは 3D ではなく、キャンバスの上の層（core/viewer.ts の maskLayer）。範囲を指定している間だけでなく、いつも出す
 */
async function setUp(page: Page, maskTop: number, maskBottom: number): Promise<void> {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  await page.evaluate(
    async ({ maskTop, maskBottom }) => {
      const { photoState, setMaskUrl } = await import('/src/core/photoState.ts');
      // 写真は灰色一色。範囲で写真を家具の上に重ねるので、家具の赤が灰色に隠れる
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
      // 写真の右寄り（横 0.5〜0.75）を囲う
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
  await expect(page.locator('.viewport__mask')).toBeVisible();
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

test('囲った所に重なる家具は、カメラから遠くても近くても、重なる所だけ隠れる', async ({ page }) => {
  await setUp(page, 0.3, 0.7);
  // 5 m 先（z = −1）。箱は横 −0.26〜0.26 に写る。右側だけが範囲（横 0〜0.5）に重なる
  await placeBox(page, -1);
  expect(await redAt(page, [[-0.15, -0.15], [0.15, -0.15]])).toEqual([true, false]);
  // 2 m 先（z = 2）に動かしても同じ
  await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoScene.update('box', { position: [0, 0, 2] }));
  expect(await redAt(page, [[-0.3, -0.3], [0.2, -0.3]])).toEqual([true, false]);
});

test('範囲を指定し終えたあとも、隠す層は出たまま', async ({ page }) => {
  await setUp(page, 0.3, 0.7);
  await page.evaluate(async () => {
    const { setMasking } = await import('/src/core/photoState.ts');
    setMasking(true);
    setMasking(false);
  });
  await expect(page.locator('.viewport__mask')).toBeVisible();
  await expect(page.locator('.viewport__mask')).not.toHaveClass(/is-editing/);
});

test('家具を隠す範囲の画面に、自動で見つける切り替えは出さない', async ({ page }) => {
  await setUp(page, 0.3, 0.7);
  await page.locator('.photo-menu__button').click();
  await page.getByRole('button', { name: '家具を隠す範囲' }).click();
  await expect(page.locator('.mask')).toBeVisible();
  await expect(page.getByText('自動で見つける')).toHaveCount(0);
});

test('家具を隠す範囲の画面の見出しと案内は短く、道具と進み具合に合わせて変わる', async ({ page }) => {
  await setUp(page, 0.3, 0.7);
  await page.locator('.photo-menu__button').click();
  await page.getByRole('button', { name: '家具を隠す範囲' }).click();
  await expect(page.locator('.mask .edit__title')).toHaveText('家具を隠す範囲');
  const guide = page.locator('.mask__guide');
  await page.locator('.mask__tools').getByRole('button', { name: 'なぞる' }).click();
  await expect(guide).toHaveText('家具を隠す範囲を、なぞって設定してください。\nなぞった部分では、家具が隠れます。');
  await page.locator('.mask__tools').getByRole('button', { name: '点で囲む' }).click();
  await expect(guide).toHaveText('家具を隠す範囲を、点で囲んで設定してください。');
  const setCorners = (count: number) =>
    page.evaluate(async (count) => {
      const { setMaskPolygon } = await import('/src/core/photoState.ts');
      setMaskPolygon(Array.from({ length: count }, (_, i) => ({ x: 0.2 + i * 0.1, y: 0.3 + (i % 2) * 0.2 })));
    }, count);
  await setCorners(1);
  await expect(guide).toHaveText('点をあと 2 個打ってください。');
  await setCorners(3);
  await expect(guide).toHaveText('「囲みを閉じる」を押して、設定してください。');
});
