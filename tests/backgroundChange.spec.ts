import { expect, test, type Page } from '@playwright/test';
import { openTab , enterEditor} from './helpers';

/**
 * 背景の画像を変えたり、写真の解析の結果でカメラ（画角・傾き・撮った高さ）が変わったりしても、
 * 置いてある家具は画面の中に残る。
 *
 * 前は、写真を変えた瞬間にカメラが既定の値に戻り、家具が画面の上で動いた。そのあと解析の結果で
 * カメラが変わると、動いたあとの写真の点に置き直すので、地平線の近くの点だと家具がずっと遠く（豆粒）へ
 * 行くか、地平線より上なら置き直せずに画面の外に残った
 */

/** 描いているカメラを捕まえる（three.js の開発者向けの合図で描画器を受け取り、render に渡るカメラを控える） */
async function openWithCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const devtools = new EventTarget();
    (window as unknown as { __THREE_DEVTOOLS__: EventTarget }).__THREE_DEVTOOLS__ = devtools;
    devtools.addEventListener('observe', (event) => {
      const renderer = (event as CustomEvent).detail;
      if (!renderer?.isWebGLRenderer || renderer.__wrapped) return;
      renderer.__wrapped = true;
      const render = renderer.render.bind(renderer);
      renderer.render = (scene: unknown, camera: unknown) => {
        (window as unknown as { __camera: unknown }).__camera = camera;
        return render(scene, camera);
      };
    });
  });
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  await openTab(page, '操作');
}

/** 写真 A があり、解析が済んだことにして、ソファを新しく置く場所に置く */
async function placeSofaOnPhotoA(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { photoState, photoScene } = await import('/src/core/photoState.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    photoState.set({
      backgroundStatus: 'ready',
      backgroundUrl: canvas.toDataURL(),
      backgroundAspect: 4 / 3,
      vfovDeg: 60,
      floorFit: { pitchDeg: -2, rollDeg: 0 },
      cameraHeight: 1.1,
    });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const size: [number, number, number] = [1.6, 0.85, 0.85];
    photoScene.add({ id: 'sofa', typeId: 'box', name: 'ソファ', color: '#888888', size, baseSize: size, position: photoScene.placementFor(size), rotationY: 0 });
    photoScene.select(null);
  });
}

/** ソファの足元（置いた位置。床に接する面の中心）が写る画面の点と、8 つの角が写る範囲（画面の座標 -1〜1）、カメラからの距離 */
async function sofaOnScreen(page: Page): Promise<{ foot: [number, number]; x: [number, number]; y: [number, number]; distance: number }> {
  return page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const { photoState } = await import('/src/core/photoState.ts');
    const camera = (window as unknown as { __camera: { position: { x: number; z: number; clone(): { set(x: number, y: number, z: number): { project(c: unknown): { x: number; y: number } } } } } }).__camera;
    const item = photoState.get().furniture.find((f) => f.id === 'sofa')!;
    const [w, h, d] = item.size;
    const [px, py, pz] = item.position;
    const project = (x: number, y: number, z: number) => camera.position.clone().set(x, y, z).project(camera);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const x of [-w / 2, w / 2]) for (const y of [0, h]) for (const z of [-d / 2, d / 2]) {
      const v = project(px + x, py + y, pz + z);
      xs.push(v.x);
      ys.push(v.y);
    }
    const foot = project(px, py, pz);
    return {
      foot: [foot.x, foot.y],
      x: [Math.min(...xs), Math.max(...xs)],
      y: [Math.min(...ys), Math.max(...ys)],
      distance: Math.hypot(px - camera.position.x, pz - camera.position.z),
    };
  });
}

function expectInside(box: { x: [number, number]; y: [number, number] }): void {
  expect(box.x[0]).toBeGreaterThan(-1);
  expect(box.x[1]).toBeLessThan(1);
  expect(box.y[0]).toBeGreaterThan(-1);
  expect(box.y[1]).toBeLessThan(1);
}

test('背景の画像を変えても、家具は画面の同じ所に残る', async ({ page }) => {
  await openWithCamera(page);
  await placeSofaOnPhotoA(page);
  const before = await sofaOnScreen(page);
  expectInside(before);
  await page.evaluate(async () => {
    const { setBackground, setFramingPhoto } = await import('/src/core/photoState.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    await setBackground(new File([blob], 'room-b.png', { type: 'image/png' }));
    setFramingPhoto(false);
  });
  // 写真を変えた直後（カメラは既定の値。解析はまだ）
  const after = await sofaOnScreen(page);
  expectInside(after);
  expect(Math.abs(after.foot[0] - before.foot[0])).toBeLessThan(0.02);
  expect(Math.abs(after.foot[1] - before.foot[1])).toBeLessThan(0.02);
});

test('解析の結果で見上げる写真になっても、地平線の近くの家具は遠くへ飛ばず画面の中に残る', async ({ page }) => {
  await openWithCamera(page);
  // 写真 A: 10° 見下ろして高さ 1.4 m から撮った写真。ソファはカメラから 6 m 先（写真の真ん中より少し下、地平線の近く）
  await page.evaluate(async () => {
    const { photoState, photoScene } = await import('/src/core/photoState.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    photoState.set({
      backgroundStatus: 'ready',
      backgroundUrl: canvas.toDataURL(),
      backgroundAspect: 4 / 3,
      vfovDeg: 50,
      floorFit: { pitchDeg: 10, rollDeg: 0 },
      cameraHeight: 1.4,
    });
    const size: [number, number, number] = [1.6, 0.85, 0.85];
    // カメラは z = 4 にあるので、z = -2 は 6 m 先
    photoScene.add({ id: 'sofa', typeId: 'box', name: 'ソファ', color: '#888888', size, baseSize: size, position: [0, 0, -2], rotationY: 0 });
    photoScene.select(null);
  });
  expectInside(await sofaOnScreen(page));
  // 解析の結果: 3.3° 見上げて、高さ 0.9 m から撮った写真だった。ソファの足元の写真の点は、新しい地平線のわずか下になる
  await page.evaluate(async () => {
    const { keepOnPhoto, photoState } = await import('/src/core/photoState.ts');
    keepOnPhoto(() => photoState.set({ vfovDeg: 60, floorFit: { pitchDeg: -3.3, rollDeg: 0 }, cameraHeight: 0.9 }));
  });
  const after = await sofaOnScreen(page);
  expectInside(after);
  expect(after.distance).toBeLessThan(12);
});
