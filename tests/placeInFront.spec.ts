import { expect, test, type Page } from '@playwright/test';

/**
 * 新しく置いた家具は、写真の物（背景）の奥に入って隠れないようにする。
 *   1. 置く場所を決めるとき、隠れるなら隠れなくなるまで手前（画面の下）へずらす
 *   2. それでも隠れる（家具が広く、手前の物の間に収まらない）ときも、動かすまでは隠さずに手前に描く
 *   3. 指で動かすと、奥行きで隠す判断に戻る
 *
 * 写真は、高さ 1.4 m から 10° 見下ろして撮った、床だけの部屋の奥行きを作り、そこに手前の物を足す
 */

/** 写真があり、解析が済んだことにする。blocks は手前の物（写真の範囲と、カメラからの距離 m） */
async function setUpPhoto(page: Page, blocks: Array<{ x: [number, number]; y: [number, number]; distance: number }>): Promise<void> {
  await page.goto('/');
  await page.locator('.sheet__tab').first().waitFor();
  await page.evaluate(async (blocks) => {
    const { photoState } = await import('/src/core/photoState.ts');
    const { levelPointAt } = await import('/src/core/depthPlacement.ts');
    const lens = { vfovDeg: 60, aspect: 4 / 3 };
    const pose = { fit: { pitchDeg: 10, rollDeg: 0 }, position: [0, 1.4, 4] as [number, number, number] };
    const width = 160;
    const height = 120;
    const t = Math.tan((lens.vfovDeg * Math.PI) / 360);
    const data = new Float32Array(width * height);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const point = { x: (column + 0.5) / width, y: (row + 0.5) / height };
        // 奥行きの地図は、正面方向の奥行きが 1 になる視線の長さで割った距離
        const rayLength = Math.hypot((point.x * 2 - 1) * t * lens.aspect, (1 - point.y * 2) * t, 1);
        const block = blocks.find((b) => point.x >= b.x[0] && point.x <= b.x[1] && point.y >= b.y[0] && point.y <= b.y[1]);
        const floor = levelPointAt(point, 0, lens, pose);
        const distance = block ? block.distance : floor ? Math.hypot(floor[0] - 0, floor[1] - 1.4, floor[2] - 4) : 20;
        data[row * width + column] = distance / rayLength;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    photoState.set({
      backgroundStatus: 'ready',
      backgroundUrl: canvas.toDataURL(),
      backgroundAspect: lens.aspect,
      vfovDeg: lens.vfovDeg,
      floorFit: pose.fit,
      cameraHeight: 1.4,
      depthMap: { width, height, data },
      depthOcclusion: true,
    });
  }, blocks);
  await page.locator('.sheet__tab', { hasText: '操作' }).click();
}

/** 隠す仕組みのオンとオフで、キャンバスの画素がいくつ変わるか（0 なら、どこも隠れていない） */
async function hiddenPixels(page: Page): Promise<number> {
  const shot = async (on: boolean) => {
    await page.evaluate(async (on) => (await import('/src/core/photoState.ts')).setDepthOcclusion(on), on);
    await page.waitForTimeout(250);
    return (await page.locator('canvas').first().screenshot()).toString('base64');
  };
  const off = await shot(false);
  const on = await shot(true);
  return page.evaluate(
    async ({ off, on }) => {
      const read = async (b64: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${b64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const a = await read(off);
      const b = await read(on);
      let changed = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) changed += 1;
      }
      return changed;
    },
    { off, on }
  );
}

test('置く場所が手前の物の奥なら、隠れなくなるまで手前へずらして置く', async ({ page }) => {
  // 画面の真ん中・下から 3 割（今までの置き場所）の床は 3.3 m 先。その手前 2.6 m に物がある
  await setUpPhoto(page, [{ x: [0.3, 0.7], y: [0.5, 0.8], distance: 2.6 }]);
  const distance = await page.evaluate(async () => {
    const { photoScene } = await import('/src/core/photoState.ts');
    const size: [number, number, number] = [0.46, 0.9, 0.5];
    const position = photoScene.placementFor(size);
    // 手前に描く旗は付けずに置く（ずらしただけで隠れなくなっていることを確かめる）
    photoScene.add({ id: 'chair', typeId: 'box', name: '椅子', color: '#ff00ff', size, baseSize: size, position, rotationY: 0 });
    photoScene.select(null);
    return Math.hypot(position[0], 1.4, position[2] - 4);
  });
  // 今までの置き場所は、カメラから 1.4 / sin(10° + 13°) ≒ 3.58 m。それより手前に置いている
  expect(distance).toBeLessThan(3.4);
  expect(await hiddenPixels(page)).toBe(0);
});

test('手前の物の間に収まらない家具も、置いた直後は手前に描き、動かすと隠す判断に戻る', async ({ page }) => {
  // 左右の下のほうに、1 m 先の物（棚と引き出しのような）。幅のある家具は、どこまで手前へずらしても重なる
  await setUpPhoto(page, [
    { x: [0, 0.42], y: [0.45, 1], distance: 1 },
    { x: [0.58, 1], y: [0.45, 1], distance: 1 },
  ]);
  // 画面の操作で、サンプルのソファを置く
  await page.locator('.manage__add').click();
  await page.locator('.page .thumb__button', { hasText: 'サンプル 2' }).first().click();
  await page.locator('.tile-actions__button', { hasText: '背景に追加' }).click();
  await expect(page.locator('.page')).toBeHidden();
  // 中身（3D モデル）が読み込まれるのを待つ
  await page.waitForTimeout(2500);
  const placed = await page.evaluate(async () => {
    const { photoScene } = await import('/src/core/photoState.ts');
    photoScene.select(null);
    return photoScene.state().furniture[0];
  });
  expect(placed.inFront).toBe(true);
  expect(await hiddenPixels(page)).toBe(0);

  // 指で少し奥へ動かすと、旗が外れ、手前の物に隠れる所が出る
  const canvas = (await page.locator('canvas').first().boundingBox())!;
  const grab = await page.evaluate(async () => {
    const { photoState, photoCameraHeight } = await import('/src/core/photoState.ts');
    const { photoPointOf } = await import('/src/core/depthPlacement.ts');
    const { photoPointAt } = await import('/src/core/photoView.ts');
    const s = photoState.get();
    const item = s.furniture[0];
    const lens = { vfovDeg: s.vfovDeg!, aspect: s.backgroundAspect! };
    const pose = { fit: s.floorFit, position: [0, photoCameraHeight(), 4] as [number, number, number] };
    const q = photoPointOf([item.position[0], item.size[1] / 2, item.position[2]], lens, pose)!;
    const a = photoPointAt(s.view, { u: 0, v: 0 });
    const b = photoPointAt(s.view, { u: 1, v: 1 });
    return { u: (q.x - a.x) / (b.x - a.x), v: (q.y - a.y) / (b.y - a.y) };
  });
  const x = canvas.x + canvas.width * grab.u;
  const y = canvas.y + canvas.height * grab.v;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(x, y - step * 6);
  await page.mouse.up();
  const moved = await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().furniture[0]);
  expect(moved.position[2]).toBeLessThan(placed.position[2]);
  expect(moved.inFront).toBeFalsy();
  await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoScene.select(null));
  expect(await hiddenPixels(page)).toBeGreaterThan(0);
});
