import { expect, test, type Page } from '@playwright/test';

/**
 * 新しく置いた家具は、写真の物（背景）の奥に入って隠れないようにする。
 *   1. 置く場所を決めるとき、隠れるなら隠れなくなるまで手前（画面の下）へずらす
 *   2. それでも隠れる（家具が広く、手前の物の間に収まらない）ときも、動かすまでは隠さずに手前に描く
 *   3. 指で動かすと、隠す判断に戻る
 *
 * 写真は、高さ 1.4 m から 10° 見下ろして撮ったことにし、家具を隠す範囲で手前の物を囲う。
 * 囲った物は、範囲のいちばん下が写る床の位置に立っている（core/maskRegions.ts）
 */

/** 写真があることにする。blocks は手前の物を囲った範囲（写真の割合） */
async function setUpPhoto(page: Page, blocks: Array<{ x: [number, number]; y: [number, number] }>): Promise<void> {
  await page.goto('/');
  await page.locator('.sheet__tab').first().waitFor();
  await page.evaluate(async (blocks) => {
    const { photoState, setMaskUrl } = await import('/src/core/photoState.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    photoState.set({
      backgroundStatus: 'ready',
      backgroundUrl: canvas.toDataURL(),
      backgroundAspect: 4 / 3,
      vfovDeg: 60,
      floorFit: { pitchDeg: 10, rollDeg: 0 },
      cameraHeight: 1.4,
    });
    const mask = document.createElement('canvas');
    mask.width = 400;
    mask.height = 300;
    const context = mask.getContext('2d')!;
    context.fillStyle = '#fff';
    for (const block of blocks) {
      context.fillRect(block.x[0] * 400, block.y[0] * 300, (block.x[1] - block.x[0]) * 400, (block.y[1] - block.y[0]) * 300);
    }
    const url = mask.toDataURL();
    (window as unknown as { maskUrl: string }).maskUrl = url;
    setMaskUrl(url);
  }, blocks);
  await page.locator('.sheet__tab', { hasText: '操作' }).click();
}

/** 囲った範囲のありと無しで、キャンバスの画素がいくつ変わるか（0 なら、どこも隠れていない） */
async function hiddenPixels(page: Page): Promise<number> {
  const shot = async (on: boolean) => {
    await page.evaluate(async (on) => {
      const { setMaskUrl } = await import('/src/core/photoState.ts');
      setMaskUrl(on ? (window as unknown as { maskUrl: string }).maskUrl : null);
    }, on);
    await expect
      .poll(() => page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().maskRegions !== null))
      .toBe(on);
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
  // 画面の真ん中・下から 3 割（今までの置き場所）の床は 3.3 m 先。その手前 2.5 m に物がある
  // （範囲のいちばん下の縦 0.8 は、真ん中から 19° 下、見下ろし 10° と合わせて 29° 下の床。1.4 / tan 29° ≒ 2.5 m）
  await setUpPhoto(page, [{ x: [0.3, 0.7], y: [0.5, 0.8] }]);
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
  // 左右の下のほうに、写真の下の端まで届く物（棚と引き出しのような）。幅のある家具は、どこまで手前へずらしても重なる
  await setUpPhoto(page, [
    { x: [0, 0.42], y: [0.45, 1] },
    { x: [0.58, 1], y: [0.45, 1] },
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
