import { enterEditor } from './helpers';
import { expect, test } from '@playwright/test';

/**
 * サンプルの中身（3D・2D・アイコン）を差し替えると、以前の版で使っていた端末には古い URL が残る
 * （ファイル名に中身のハッシュが付き、公開先から古いファイルが消える）。起動したときに今の URL に読み替える
 */
const OLD_MODEL = '/roomplanner-web/assets/chair-Abc123_-.glb';
const OLD_CUTOUT = '/roomplanner-web/assets/chair-cutout-Zyx987-_.webp';

test('一覧に残っている古いサンプルと、置いてある古いサンプルの中身を、今の版のものにする', async ({ page }) => {
  await page.addInitScript(({ model, cutout }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('roomplanner.samplesSeeded', '1');
    localStorage.setItem('roomplanner.models', JSON.stringify([
      // 名前と高さは利用者が変えたもの（変えない）
      { id: 'sample-chair', name: 'マイ椅子', modelKey: model, imageKey: cutout, previewKey: 'data:image/webp;base64,old', size: [0.46, 0.9, 0.5], height: 0.8, createdAt: 0 },
    ]));
    const size = [0.46, 0.9, 0.5];
    localStorage.setItem('roomplanner.photo', JSON.stringify({
      furniture: [
        { id: 'p3', typeId: 'generated', name: 'マイ椅子', color: '#ccc', size, baseSize: size, position: [0, 0, 1], rotationY: 0, modelUrl: model, sourceImageKey: 'data:image/webp;base64,old' },
        { id: 'p2', typeId: 'generated', name: 'マイ椅子', color: '#ccc', size, baseSize: size, position: [0.5, 0, 1], rotationY: 0, imageUrl: cutout },
        // サンプルではない家具はそのまま
        { id: 'mine', typeId: 'generated', name: '自分の家具', color: '#ccc', size, baseSize: size, position: [-0.5, 0, 1], rotationY: 0, modelUrl: '/generated/abc.glb' },
      ],
    }));
  }, { model: OLD_MODEL, cutout: OLD_CUTOUT });
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  const r = await page.evaluate(async () => {
    const { SAMPLE_MODELS } = await import('/src/config/samples.ts');
    const { modelLibrary } = await import('/src/core/modelLibrary.ts');
    const { photoState } = await import('/src/core/photoState.ts');
    const current = SAMPLE_MODELS.find((model) => model.id === 'sample-chair')!;
    const chair = modelLibrary.get().models.find((model) => model.id === 'sample-chair')!;
    const placed = Object.fromEntries(photoState.get().furniture.map((item) => [item.id, item]));
    return { current, chair, placed };
  });
  expect(r.chair.modelKey).toBe(r.current.modelKey);
  expect(r.chair.imageKey).toBe(r.current.imageKey);
  expect(r.chair.previewKey).toBe(r.current.previewKey);
  expect(r.chair.size).toEqual(r.current.size);
  expect(r.chair.name).toBe('マイ椅子');
  expect(r.chair.height).toBe(0.8);
  expect(r.placed.p3.modelUrl).toBe(r.current.modelKey);
  expect(r.placed.p3.sourceImageKey).toBe(r.current.previewKey);
  expect(r.placed.p2.imageUrl).toBe(r.current.imageKey);
  expect(r.placed.mine.modelUrl).toBe('/generated/abc.glb');
});
