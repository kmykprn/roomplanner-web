import { expect, test } from '@playwright/test';
import { openTab } from './helpers';

/**
 * 家具を作り始めたとき（写真を送っている間・順番を待つ間）は、文言を「準備中」にし、円を少しずつ進める。
 * 前は「送信中」「順番待ち」で、円は 0 のまま動かず、押しても反応していないように見えた。
 * 作業が始まったら、その続きから進む（円は戻らない）
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
});

test('3D: 押した瞬間から円が少し出て、順番待ちの間も進み、作業が始まっても戻らない', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { preparingRatio, progressFor } = await import('/src/core/progress.ts');
    return {
      uploadStart: preparingRatio('uploading', 0),
      uploadEnd: preparingRatio('uploading', 60),
      queueStart: preparingRatio('queued', 0),
      queueMid: preparingRatio('queued', 15),
      queueEnd: preparingRatio('queued', 600),
      runningStart: progressFor(null, 0).ratio,
      unknown: progressFor('???', 0).ratio,
      label: progressFor(null, 0).label,
    };
  });
  expect(r.uploadStart).toBeGreaterThan(0);
  expect(r.uploadEnd).toBeGreaterThan(r.uploadStart);
  expect(r.queueStart).toBeGreaterThanOrEqual(r.uploadEnd);
  expect(r.queueMid).toBeGreaterThan(r.queueStart);
  // 待ちが長引いても 10% 未満で止まる（止まっていても嘘にならないように）
  expect(r.queueEnd).toBeLessThan(0.1);
  expect(r.runningStart).toBeGreaterThanOrEqual(r.queueEnd);
  expect(r.unknown).toBeGreaterThanOrEqual(r.queueEnd);
  expect(r.label).toBe('準備しています');
});

test('2D: 送っている間も「準備中」で円が少し出て、順番待ちはその続きから進む', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { cutoutProgress } = await import('/src/core/cutout.ts');
    const now = Date.now();
    const base = { id: 'x', fileName: 'a', previewUrl: null, serverPhase: null, expectedSeconds: null, phaseStartedAt: now } as never;
    const uploading = cutoutProgress({ ...(base as object), phase: 'uploading' } as never, now);
    const uploaded = cutoutProgress({ ...(base as object), phase: 'uploading' } as never, now + 60_000);
    const queued = cutoutProgress({ ...(base as object), phase: 'cutting', serverPhase: 'queued' } as never, now);
    return { uploading, uploaded, queued };
  });
  expect(r.uploading.label).toBe('準備中');
  expect(r.uploading.ratio).toBeGreaterThan(0);
  expect(r.queued.label).toBe('準備中');
  expect(r.queued.ratio).toBeGreaterThanOrEqual(r.uploaded.ratio);
});

test('作成中の 3D のタイルは、送っている間も順番待ちも「準備中」で、円が出ている', async ({ page }) => {
  await page.evaluate(async () => {
    const { generationState } = await import('/src/core/generation.ts');
    const job = {
      id: 'j1', jobId: null, fileName: '椅子', previewKey: null, previewUrl: null, phase: 'uploading',
      createdAt: Date.now(), startedAt: null, startedRunningAt: null, serverPhase: null, serverPhaseStartedAt: null,
      engine: 'hunyuan', targetModelId: null, error: null,
    };
    generationState.set({ ...generationState.get(), jobs: [job as never] });
  });
  await openTab(page, '操作');
  await page.locator('.manage__add').click();
  const tile = page.locator('.page .thumb').filter({ has: page.locator('.ring') }).first();
  await expect(tile.locator('.thumb__name')).toHaveText('準備中');
  // 塗られている円の残り（strokeDashoffset）が、円周より短い＝少しでも塗られている
  const ring = await tile.locator('.ring__value').evaluate((circle) => ({
    offset: Number((circle as SVGCircleElement).style.strokeDashoffset),
    full: 2 * Math.PI * Number(circle.getAttribute('r')),
  }));
  expect(ring.offset).toBeLessThan(ring.full - 0.5);
  await page.evaluate(async () => {
    const { generationState } = await import('/src/core/generation.ts');
    const [job] = generationState.get().jobs;
    generationState.set({ ...generationState.get(), jobs: [{ ...job, phase: 'queued', jobId: 'job_x', startedAt: Date.now() }] });
  });
  await expect(tile.locator('.thumb__name')).toHaveText('準備中');
});
