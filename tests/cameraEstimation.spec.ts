import { expect, test } from '@playwright/test';

/**
 * 写真の画角を、奥行きの AI の出力から推定する（core/depthModel.ts の estimateVfov）。
 * 画角の分かっている斜めの平面を、AI の出力と同じ形（奥行きを一定量ずらした点）で作り、元の画角に戻ることを確かめる。
 * 横長と、回して入れる縦長の両方で確かめる
 */
test('奥行きの AI の出力から、写真の画角を推定する', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { estimateVfov } = await import('/src/core/depthModel.ts');
    const WIDTH = 560, HEIGHT = 420;
    const modelAspect = WIDTH / HEIGHT;
    const spanX = modelAspect / Math.sqrt(1 + modelAspect * modelAspect);
    const spanY = 1 / Math.sqrt(1 + modelAspect * modelAspect);
    function synthesize(photoWidth: number, photoHeight: number, vfovDeg: number) {
      // depthFromOutput と同じ決め方で、画角から焦点距離（写真の対角の半分を 1 とした長さ）を出す
      const rotate = photoHeight > photoWidth;
      const halfVertical = Math.tan((vfovDeg * Math.PI) / 360);
      const halfHorizontal = rotate ? halfVertical : halfVertical * modelAspect;
      const focal = spanX / halfHorizontal;
      const points = new Float32Array(WIDTH * HEIGHT * 3);
      const mask = new Float32Array(WIDTH * HEIGHT).fill(1);
      // 斜めの平面 n·P = 2 の点。AI の出力は奥行きが一定量（0.8）ずれている
      const n = [0.1, 0.5, 0.86];
      for (let row = 0; row < HEIGHT; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
          const u = spanX * ((2 * column + 1) / WIDTH - 1);
          const v = spanY * ((2 * row + 1) / HEIGHT - 1);
          const z = 2 / (n[0] * (u / focal) + n[1] * (v / focal) + n[2]);
          const i = row * WIDTH + column;
          points[i * 3] = (u / focal) * z;
          points[i * 3 + 1] = (v / focal) * z;
          points[i * 3 + 2] = z - 0.8;
        }
      }
      const output = {
        points: { data: points, dims: [1, HEIGHT, WIDTH, 3] },
        mask: { data: mask, dims: [1, HEIGHT, WIDTH] },
        metric_scale: { data: new Float32Array([1]), dims: [1] },
      };
      return estimateVfov({ output, photoWidth, photoHeight } as never);
    }
    return { landscape: synthesize(1600, 1200, 55), portrait: synthesize(1200, 1600, 70) };
  });
  expect(result.landscape).toBeCloseTo(55, 1);
  expect(result.portrait).toBeCloseTo(70, 1);
});

/**
 * 写真の床の面から、見下ろし角・傾き・撮った高さを出す（core/depthPlacement.ts の findFloorPlane）。
 * 高さ 1.3 m、見下ろし 10°、右に 3° 傾けて撮った床に、高さ 0.7 m の天板が大きく写っている奥行きを作る
 */
async function floorPlaneOf(page: import('@playwright/test').Page, prior: { pitchDeg: number; rollDeg: number }) {
  await page.goto('/');
  return page.evaluate(async (prior) => {
    const { findFloorPlane, levelPointAt } = await import('/src/core/depthPlacement.ts');
    const lens = { vfovDeg: 60, aspect: 4 / 3 };
    const pose = { fit: { pitchDeg: 10, rollDeg: 3 }, position: [0, 1.3, 0] as [number, number, number] };
    const width = 200, rows = 150;
    const t = Math.tan((lens.vfovDeg * Math.PI) / 360);
    const data = new Float32Array(width * rows);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < width; c += 1) {
        const point = { x: (c + 0.5) / width, y: (r + 0.5) / rows };
        // 左下の 4 割 × 下 4 割に天板（床の面より大きく写る所もある）
        const top = point.x < 0.4 && point.y > 0.6 ? 0.7 : 0;
        const hit = levelPointAt(point, top, lens, pose) ?? levelPointAt(point, 0, lens, pose);
        // 奥行きの地図は、正面方向の奥行きが 1 になる視線の長さで割った距離
        const rayLength = Math.hypot((point.x * 2 - 1) * t * lens.aspect, (1 - point.y * 2) * t, 1);
        data[r * width + c] = hit ? Math.hypot(hit[0], hit[1] - 1.3, hit[2]) / rayLength : Number.NaN;
      }
    }
    return findFloorPlane({ width, height: rows, data }, lens, prior);
  }, prior);
}

test('天板が大きく写っていても、いちばん下の面を床として高さと向きを出す', async ({ page }) => {
  // 傾きの AI の値が 2° ずれていても、床の面から本来の向きに直る
  const result = await floorPlaneOf(page, { pitchDeg: 12, rollDeg: 1 });
  expect(result).not.toBeNull();
  expect(result!.cameraHeight).toBeCloseTo(1.3, 1);
  expect(Math.abs(result!.fit.pitchDeg - 10)).toBeLessThan(0.5);
  expect(Math.abs(result!.fit.rollDeg - 3)).toBeLessThan(0.5);
});

test('傾きの AI の値と床の向きが大きく違えば、床の面を使わない', async ({ page }) => {
  const result = await floorPlaneOf(page, { pitchDeg: 20, rollDeg: 3 });
  expect(result).toBeNull();
});
