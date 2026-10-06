import { expect, test } from '@playwright/test';

/**
 * 保存した背景と部屋の一覧（core/sceneLibrary.ts）と、中身の読み書き（core/persistence.ts）。
 * 背景と部屋を何組も持ち、開くものを切り替えると中身（家具）が入れ替わり、開き直しても残る
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
});

/** 置く家具（毎回別の id） */
const chairAt = (x: number) => {
  const size: [number, number, number] = [0.5, 0.9, 0.5];
  return { id: `c${x}-${Math.random().toString(36).slice(2, 8)}`, typeId: 'box', name: '椅子', color: '#ccc', size, baseSize: size, position: [x, 0, 0] as [number, number, number], rotationY: 0 };
};
const CHAIR_SOURCE = chairAt.toString();

test('初めての起動では背景が 1 つだけでき（部屋は作らない）、置いた家具はその鍵に残る', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { sceneLibrary, photoDataKey, entriesOf } = await import('/src/core/sceneLibrary.ts');
    const { photoScene } = await import('/src/core/photoState.ts');
    const { current } = sceneLibrary.get();
    const size: [number, number, number] = [0.5, 0.9, 0.5];
    photoScene.add({ id: 'c1', typeId: 'box', name: '椅子', color: '#ccc', size, baseSize: size, position: [0, 0, 0], rotationY: 0 });
    const saved = JSON.parse(localStorage.getItem(photoDataKey(current.photo!)) ?? '{}');
    return {
      photos: entriesOf('photo').map((e) => e.name),
      rooms: entriesOf('room').map((e) => e.name),
      current,
      savedCount: saved.furniture?.length,
      index: JSON.parse(localStorage.getItem('roomplanner.scenes') ?? 'null'),
    };
  });
  expect(r.photos).toHaveLength(1);
  expect(r.photos[0]).toMatch(/^背景 \d+\/\d+$/);
  expect(r.rooms).toHaveLength(0);
  expect(r.current.photo).toBeTruthy();
  expect(r.current.room).toBeNull();
  expect(r.savedCount).toBe(1);
  expect(r.index.entries).toHaveLength(1);
});

test('背景を切り替えると家具が入れ替わり、開き直しても開いていたものが残る', async ({ page }) => {
  const r = await page.evaluate(async (source) => {
    const chair = new Function(`return (${source})`)() as (x: number) => Parameters<typeof photoScene.add>[0];
    const { sceneLibrary, createScene, openScene } = await import('/src/core/sceneLibrary.ts');
    const { photoScene, photoState } = await import('/src/core/photoState.ts');
    const first = sceneLibrary.get().current.photo!;
    photoScene.add(chair(0));
    photoScene.add(chair(1));
    const second = createScene('photo', '寝室');
    openScene(second.id);
    const afterOpenSecond = photoState.get().furniture.length;
    photoScene.add(chair(2));
    openScene(first);
    const backToFirst = photoState.get().furniture.length;
    openScene(second.id);
    return { afterOpenSecond, backToFirst, secondCount: photoState.get().furniture.length, second: second.id };
  }, CHAIR_SOURCE);
  expect(r.afterOpenSecond).toBe(0);
  expect(r.backToFirst).toBe(2);
  expect(r.secondCount).toBe(1);

  await page.reload();
  await page.locator('.sheet').first().waitFor();
  const after = await page.evaluate(async () => {
    const { sceneLibrary, currentScene } = await import('/src/core/sceneLibrary.ts');
    const { photoState } = await import('/src/core/photoState.ts');
    return { current: sceneLibrary.get().current.photo, name: currentScene('photo')?.name, count: photoState.get().furniture.length };
  });
  expect(after.current).toBe(r.second);
  expect(after.name).toBe('寝室');
  expect(after.count).toBe(1);
});

test('前の版の背景と部屋は、最初の起動で一覧に入り、古い鍵は消える', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.clear();
    const size = [0.5, 0.9, 0.5];
    localStorage.setItem('roomplanner.photo', JSON.stringify({ furniture: [{ id: 'p1', typeId: 'chair', name: '椅子', color: '#ccc', size, baseSize: size, position: [0, 0, 1], rotationY: 0 }] }));
    localStorage.setItem('roomplanner.room', JSON.stringify({ furniture: [{ id: 'r1', typeId: 'chair', name: '椅子', color: '#ccc', size, baseSize: size, position: [0, 0, 0], rotationY: 0 }, { id: 'r2', typeId: 'chair', name: '椅子', color: '#ccc', size, baseSize: size, position: [1, 0, 0], rotationY: 0 }], interior: { template: 'japanese', mats: 8 } }));
  });
  await page.reload();
  await page.locator('.sheet').first().waitFor();
  const r = await page.evaluate(async () => {
    const { entriesOf, sceneLibrary, photoDataKey, roomDataKey } = await import('/src/core/sceneLibrary.ts');
    const { photoState } = await import('/src/core/photoState.ts');
    const { appState } = await import('/src/core/appState.ts');
    const { current } = sceneLibrary.get();
    return {
      photos: entriesOf('photo').length,
      rooms: entriesOf('room').length,
      photoCount: photoState.get().furniture.length,
      roomCount: appState.get().furniture.length,
      interior: appState.get().interior,
      legacy: [localStorage.getItem('roomplanner.photo'), localStorage.getItem('roomplanner.room')],
      moved: [localStorage.getItem(photoDataKey(current.photo!)) !== null, localStorage.getItem(roomDataKey(current.room!)) !== null],
    };
  });
  expect(r.photos).toBe(1);
  expect(r.rooms).toBe(1);
  expect(r.photoCount).toBe(1);
  expect(r.roomCount).toBe(2);
  expect(r.interior).toEqual({ template: 'japanese', mats: 8 });
  expect(r.legacy).toEqual([null, null]);
  expect(r.moved).toEqual([true, true]);
});

test('名前を変える・複製する・削除する。開いているものを消したら残りで一番新しいものを開く', async ({ page }) => {
  const r = await page.evaluate(async (source) => {
    const chair = new Function(`return (${source})`)() as (x: number) => Parameters<typeof roomScene.add>[0];
    const { sceneLibrary, createScene, openScene, renameScene, duplicateScene, deleteScenes, entriesOf, currentScene } = await import('/src/core/sceneLibrary.ts');
    const { appState, roomScene } = await import('/src/core/appState.ts');
    const first = createScene('room').id;
    openScene(first);
    renameScene(first, '  和室  ');
    roomScene.add(chair(0));
    const copy = (await duplicateScene(first))!;
    openScene(copy.id);
    const copyCount = appState.get().furniture.length;
    roomScene.add(chair(1));
    const third = createScene('room', '三つ目');
    openScene(third.id);
    await deleteScenes([third.id]);
    const afterDeleteCurrent = currentScene('room');
    await deleteScenes(entriesOf('room').map((e) => e.id));
    return {
      copyName: copy.name,
      copyCount,
      afterDeleteCurrent: afterDeleteCurrent?.name,
      afterDeleteCurrentCount: afterDeleteCurrent ? appState.get().furniture.length : null,
      remaining: entriesOf('room').length,
      currentAfterAll: sceneLibrary.get().current.room,
      countAfterAll: appState.get().furniture.length,
    };
  }, CHAIR_SOURCE);
  expect(r.copyName).toBe('和室 のコピー');
  expect(r.copyCount).toBe(1);
  // 三つ目を消したら、残りで一番新しいもの（直前に家具を足したコピー）を開く
  expect(r.afterDeleteCurrent).toBe('和室 のコピー');
  expect(r.remaining).toBe(0);
  expect(r.currentAfterAll).toBeNull();
  expect(r.countAfterAll).toBe(0);
});

test('いま見えているものから一覧のアイコンを作って残す', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { setMode } = await import('/src/core/mode.ts');
    const { createScene, openScene, snapshotScene, readSceneThumbnail } = await import('/src/core/sceneLibrary.ts');
    const id = createScene('room').id;
    openScene(id);
    setMode('room');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await snapshotScene(id);
    const blob = await readSceneThumbnail(id);
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    return { size: blob.size, width: bitmap.width, height: bitmap.height, type: blob.type };
  });
  expect(r).not.toBeNull();
  expect(r!.width).toBe(360);
  expect(r!.height).toBe(480);
  expect(r!.size).toBeGreaterThan(1000);
});
