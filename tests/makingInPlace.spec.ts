import { expect, test } from '@playwright/test';
import { openTab } from './helpers';

/**
 * 2D の家具から 3D を作っている間は、作成中の別のタイルを出さず、その家具のタイルの上で円を回す。
 * 名前の所に「準備中」などを出し、作っている間も押せる（2D はメニューから置ける）。できあがると円が消えて 3D の印が付く
 */
test('3D を作っている間は、元の家具のタイルの上で円が回り、別のタイルは増えない', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await page.evaluate(async () => {
    const { modelLibrary } = await import('/src/core/modelLibrary.ts');
    const sofa = modelLibrary.get().models.find((model) => model.name === 'サンプル 2')!;
    modelLibrary.set({ models: [...modelLibrary.get().models, { ...sofa, id: 'flat-sofa', name: 'ソファ', modelKey: null }] });
    const { generationState } = await import('/src/core/generation.ts');
    const now = Date.now();
    generationState.set({
      ...generationState.get(),
      jobs: [{
        id: 'j', jobId: 'job_x', fileName: 'ソファ', previewKey: null, previewUrl: null, phase: 'queued',
        createdAt: now, startedAt: now, startedRunningAt: null, serverPhase: null, serverPhaseStartedAt: null,
        engine: 'hunyuan', targetModelId: 'flat-sofa', error: null,
      } as never],
    });
  });
  await openTab(page, '操作');
  await page.locator('.manage__add').click();
  // 追加・サンプル 2 つ・ソファの 4 枚だけ（作成中の別のタイルは無い）
  await expect(page.locator('.page .tiles > .thumb')).toHaveCount(4);
  const tile = page.locator('.page .thumb__button', { hasText: '準備中' });
  await expect(tile).toHaveCount(1);
  await expect(tile.locator('.ring')).toBeVisible();
  await expect(tile).toBeEnabled();
  // 押すとメニューが出て、2D で置ける
  await tile.click();
  await expect(page.locator('.tile-actions__name')).toHaveText('ソファ');

  // できあがったら（3D が付いて、作成が終わったら）、円が消えて名前と 3D の印に戻る
  await page.locator('.tile-actions__dim').click({ position: { x: 20, y: 20 } });
  await page.evaluate(async () => {
    const { modelLibrary } = await import('/src/core/modelLibrary.ts');
    const sample = modelLibrary.get().models.find((model) => model.name === 'サンプル 2')!;
    modelLibrary.set({ models: modelLibrary.get().models.map((model) => (model.id === 'flat-sofa' ? { ...model, modelKey: sample.modelKey } : model)) });
    const { generationState } = await import('/src/core/generation.ts');
    generationState.set({ ...generationState.get(), jobs: [] });
  });
  const done = page.locator('.page .thumb__button', { hasText: 'ソファ' });
  await expect(done.locator('.ring')).toBeHidden();
  await expect(done.locator('.solid-mark')).toBeVisible();
});
