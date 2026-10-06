import { expect, test } from '@playwright/test';
import { openWithTwoCutouts } from './helpers';

/**
 * 端末への保存は、指で触っている間は待ち、離したときにまとめて 1 回にする。
 * 指で触っている間 = beginEdit から endEdit まで（家具のドラッグ・バー・上下の移動）
 */
test('家具を動かしている間は保存せず、離したときに保存する', async ({ page }) => {
  const [id] = await openWithTwoCutouts(page);

  const result = await page.evaluate(async (movingId) => {
    const { activeScene, isPhotoMode } = await import('/src/core/mode.ts');
    const { beginEdit, endEdit } = await import('/src/core/editHistory.ts');
    const { sceneLibrary, photoDataKey, roomDataKey } = await import('/src/core/sceneLibrary.ts');
    const key = isPhotoMode() ? photoDataKey(sceneLibrary.get().current.photo!) : roomDataKey(sceneLibrary.get().current.room!);
    const savedX = (): number | undefined =>
      JSON.parse(localStorage.getItem(key) ?? '{}').furniture?.find((f: { id: string }) => f.id === movingId)?.position[0];

    // 保存の回数を数える
    let writes = 0;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name: string, value: string) {
      if (name === key) writes += 1;
      return setItem.call(this, name, value);
    };

    const scene = activeScene();
    const before = savedX();
    beginEdit(scene);
    for (let step = 1; step <= 20; step += 1) scene.update(movingId, { position: [step * 0.05, 0, 0] });
    const whileEditing = { writes, x: savedX() };
    endEdit(scene);
    const afterRelease = { writes, x: savedX() };
    Storage.prototype.setItem = setItem;
    return { before, whileEditing, afterRelease };
  }, id);

  // 動かしている間は、1 回も書かず、保存された位置も元のまま
  expect(result.whileEditing.writes).toBe(0);
  expect(result.whileEditing.x).toBe(result.before);
  // 離したら 1 回だけ書き、最後の位置が残る
  expect(result.afterRelease.writes).toBe(1);
  expect(result.afterRelease.x).toBeCloseTo(1);
});

test('指で触っていないときの変更は、すぐ保存する', async ({ page }) => {
  const [id] = await openWithTwoCutouts(page);
  const saved = await page.evaluate(async (removedId) => {
    const { activeScene, isPhotoMode } = await import('/src/core/mode.ts');
    const { sceneLibrary, photoDataKey, roomDataKey } = await import('/src/core/sceneLibrary.ts');
    const key = isPhotoMode() ? photoDataKey(sceneLibrary.get().current.photo!) : roomDataKey(sceneLibrary.get().current.room!);
    activeScene().remove(removedId);
    return JSON.parse(localStorage.getItem(key) ?? '{}').furniture.map((f: { id: string }) => f.id);
  }, id);
  expect(saved).not.toContain(id);
});
