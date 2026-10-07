import { enterEditor } from './helpers';
import { expect, test } from '@playwright/test';

/**
 * 写真を撮った高さを、解析した奥行きから見積もる（core/depthPlacement.ts の estimateCameraHeight）。
 * 高さ 1.3 m から少し見下ろして撮った、平らな床だけの奥行きを作り、1.3 m に戻ることを確かめる。
 * 写真の下のほうに床より高い物（棚の天板など）が写っていても、床の高さを取る
 */
test('平らな床の奥行きから、撮った高さを見積もる', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { estimateCameraHeight } = await import('/src/core/depthPlacement.ts');
    const lens = { vfovDeg: 70, aspect: 4 / 3 };
    const fit = { pitchDeg: 10, rollDeg: 0 };
    const height = 1.3;
    const width = 160, rows = 120;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const t = Math.tan(toRad(lens.vfovDeg) / 2);
    const pitch = toRad(-fit.pitchDeg);
    function floorDepth(x: number, y: number, objectTop: number | null): number {
      // カメラの座標の視線（正面の奥行きが 1）を、見下ろす向きに回して、床（高さ −height）と交わる距離を出す
      const ray = [(x * 2 - 1) * t * lens.aspect, (1 - y * 2) * t, -1];
      const down = ray[1] * Math.cos(pitch) - ray[2] * Math.sin(pitch);
      const surface = objectTop === null ? -height : -height + objectTop;
      return down < 0 ? surface / down : 20;
    }
    const data = new Float32Array(width * rows);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < width; c += 1) {
        const x = (c + 0.5) / width, y = (r + 0.5) / rows;
        // 左下の 2 割に、高さ 0.7 m の天板が写っている
        const objectTop = x < 0.2 && y > 0.7 ? 0.7 : null;
        data[r * width + c] = floorDepth(x, y, objectTop);
      }
    }
    return estimateCameraHeight({ width, height: rows, data }, lens, fit);
  });
  expect(result).not.toBeNull();
  expect(result!).toBeCloseTo(1.3, 2);
});

/**
 * 写真を選ぶと、拡大・縮小の画面が開く。「保存」を押したら閉じて、寸法の画面は開かない
 * （寸法を合わせなくても、撮った高さを見積もるので家具の大きさはほぼ合う）
 */
test('写真を選んで拡大・縮小を保存しても、寸法の画面は開かない', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  await page.evaluate(async () => {
    const { setBackground } = await import('/src/core/photoState.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#c8b090';
    context.fillRect(0, 0, 64, 48);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    await setBackground(new File([blob], 'room.png', { type: 'image/png' }));
  });
  const state = () =>
    page.evaluate(async () => {
      const { photoState } = await import('/src/core/photoState.ts');
      const { isFramingPhoto, isScaling } = photoState.get();
      return { isFramingPhoto, isScaling };
    });
  await expect.poll(state).toEqual({ isFramingPhoto: true, isScaling: false });
  // 見えている拡大・縮小の画面の「保存」を押す
  await page.locator('.sub:not([hidden]) button', { hasText: '保存' }).click();
  await expect.poll(state).toEqual({ isFramingPhoto: false, isScaling: false });
});
