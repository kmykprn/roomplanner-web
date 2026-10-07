import { readFileSync } from 'node:fs';
import { enterEditor } from './helpers';
import { expect, test, type Page } from '@playwright/test';

/**
 * 写真から家具を切り抜くのを、端末の中で行う（core/cutoutModel.ts）。
 * 部屋の写真に椅子の切り抜きを合成した写真を切り抜き、Python の onnxruntime で同じモデルを動かした結果と、
 * 合成に使った正しい輪郭に、どちらもよく重なることを確かめる。サーバーには頼まない
 */
const fixture = (name: string): number[] => Array.from(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

/**
 * 切り抜き（透過 PNG）と、元の写真と同じ大きさのマスク（0〜255 の PNG）の重なり（IoU）。
 * 切り抜きは中身のまわりで切り詰めてあるので、マスクも同じ決まり（不透明度 8 以上の範囲に 2% の余白）で切り詰めてから、
 * 同じ大きさに縮めて比べる
 */
async function overlap(page: Page, cutoutPng: number[], maskPng: number[]): Promise<number> {
  return page.evaluate(
    async ({ cutoutPng, maskPng }) => {
      const bitmap = async (bytes: number[]) => createImageBitmap(new Blob([new Uint8Array(bytes)]));
      const mask = await bitmap(maskPng);
      const full = document.createElement('canvas');
      full.width = mask.width;
      full.height = mask.height;
      const fc = full.getContext('2d')!;
      fc.drawImage(mask, 0, 0);
      const d = fc.getImageData(0, 0, mask.width, mask.height).data;
      let left = mask.width, top = mask.height, right = -1, bottom = -1;
      for (let y = 0; y < mask.height; y += 1) for (let x = 0; x < mask.width; x += 1) {
        if (d[(y * mask.width + x) * 4] < 8) continue;
        if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
      }
      right += 1; bottom += 1;
      const mx = Math.floor((right - left) * 0.02), my = Math.floor((bottom - top) * 0.02);
      const box = { x: Math.max(0, left - mx), y: Math.max(0, top - my), w: Math.min(mask.width, right + mx) - Math.max(0, left - mx), h: Math.min(mask.height, bottom + my) - Math.max(0, top - my) };
      const W = 300, H = Math.round((W * box.h) / box.w);
      const small = (draw: (c: CanvasRenderingContext2D) => void) => {
        const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d')!; draw(ctx); return ctx.getImageData(0, 0, W, H).data;
      };
      const cut = await bitmap(cutoutPng);
      const a = small((ctx) => ctx.drawImage(cut, 0, 0, cut.width, cut.height, 0, 0, W, H));
      const b = small((ctx) => ctx.drawImage(mask, box.x, box.y, box.w, box.h, 0, 0, W, H));
      let both = 0, either = 0;
      for (let i = 0; i < a.length; i += 4) {
        // 切り抜きは不透明度、マスクは明るさで持っている
        const x = a[i + 3] >= 128, y = b[i] >= 128;
        if (x && y) both += 1;
        if (x || y) either += 1;
      }
      return both / either;
    },
    { cutoutPng, maskPng }
  );
}

test('写真を端末の中で切り抜き、Python で動かした結果と正しい輪郭によく重なる', async ({ page }) => {
  // モデル（52MB）を落として動かすので長い。CI は手元の 2 倍ほど遅い
  test.slow();
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  let serverCalls = 0;
  await page.route('**/cutout-jobs**', (route) => {
    serverCalls += 1;
    void route.fulfill({ status: 503, body: '{}' });
  });
  const photo = fixture('chair-in-room.jpg');
  const result = await page.evaluate(async (bytes) => {
    const { cutoutOnDevice } = await import('/src/core/cutoutModel.ts');
    const { lastHeapInfo } = await import('/src/core/onnxModel.ts');
    const started = performance.now();
    const png = await cutoutOnDevice(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    const bitmap = await createImageBitmap(png);
    return { bytes: Array.from(new Uint8Array(await png.arrayBuffer())), width: bitmap.width, height: bitmap.height, seconds: (performance.now() - started) / 1000, heap: lastHeapInfo() };
  }, photo);
  console.log(`端末での切り抜き: ${result.seconds.toFixed(1)} 秒、${result.width}×${result.height}、ワーカーのメモリ ${result.heap?.megabytes}MB`);
  // ワーカーのメモリの伸びが画面に届いている（落ちる直前の大きさを残すのに使う）。PC では 600MB ほど
  expect(result.heap?.megabytes ?? 0).toBeGreaterThan(300);
  // 中身のまわりで切り詰めてある（椅子は写真の一部）
  expect(result.width).toBeLessThan(1024);
  expect(result.height).toBeLessThan(768);
  expect(serverCalls).toBe(0);

  const vsPython = await overlap(page, result.bytes, fixture('chair-in-room-mask.png'));
  const vsTruth = await overlap(page, result.bytes, fixture('chair-in-room-truth.png'));
  console.log(`重なり: Python の結果と ${vsPython.toFixed(3)}、正しい輪郭と ${vsTruth.toFixed(3)}`);
  expect(vsPython).toBeGreaterThan(0.95);
  expect(vsTruth).toBeGreaterThan(0.9);
});
