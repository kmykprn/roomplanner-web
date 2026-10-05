import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * 端末での切り抜きは、深度の AI が残したメモリの上に積まない（core/cutoutModel.ts、core/onnxModel.ts の releaseWorker）。
 * 同じワーカーで深度 → 切り抜きと動かすと、wasm のメモリは縮まないので 804MB まで伸びた（切り抜きだけなら 621MB）。
 * 切り抜きの前後でワーカーを作り直すと、切り抜きだけのときと同じ高さで収まり、そのあと深度の AI も動く
 */
test('深度のあとに切り抜いても、ワーカーのメモリは切り抜きだけのときと同じ高さで収まる', async ({ page }) => {
  // モデル（深度 25MB と切り抜き 52MB）を落として動かすので長い
  test.slow();
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  const photo = Array.from(readFileSync(new URL('./fixtures/chair-in-room.jpg', import.meta.url)));
  const r = await page.evaluate(async (bytes) => {
    const { lastHeapInfo } = await import('/src/core/onnxModel.ts');
    const { runDepthNetwork } = await import('/src/core/depthModel.ts');
    const { cutoutOnDevice } = await import('/src/core/cutoutModel.ts');
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    await runDepthNetwork(url);
    const afterDepth = lastHeapInfo()!.megabytes;
    await cutoutOnDevice(blob);
    const afterCutout = lastHeapInfo()!.megabytes;
    // 切り抜きのあとも深度の AI は動く（ワーカーとモデルを読み直す）
    const depth = await runDepthNetwork(url);
    return { afterDepth, afterCutout, depthWidth: depth.photoWidth };
  }, photo);
  console.log(`ワーカーのメモリ: 深度のあと ${r.afterDepth}MB、切り抜きのあと ${r.afterCutout}MB`);
  expect(r.afterDepth).toBeGreaterThan(300);
  // 同じワーカーで続けると 804MB。作り直せば 621MB 前後
  expect(r.afterCutout).toBeLessThan(700);
  expect(r.depthWidth).toBeGreaterThan(0);
});
