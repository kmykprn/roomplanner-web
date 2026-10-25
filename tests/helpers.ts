import type { Page } from '@playwright/test';

/**
 * アプリを開き、置き場（いまのモードの家具の一覧）に、切り抜きの画像を持つ家具を 2 つ置く。
 * 何も選んでいない状態にして、置いた家具の id を返す
 */
export async function openWithTwoCutouts(page: Page): Promise<string[]> {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
  await enterEditor(page);
  return page.evaluate(async () => {
    const { activeScene } = await import('/src/core/mode.ts');
    const scene = activeScene();
    const ids = ['test-a', 'test-b'];
    ids.forEach((id, index) =>
      scene.add({
        id,
        typeId: 'chair',
        name: `テスト ${index + 1}`,
        color: '#888888',
        imageUrl: '/src/assets/furniture/chair-cutout.webp',
        position: [index, 0, 0],
        size: [0.5, 0.8, 0.5],
        rotationY: 0,
      })
    );
    scene.select(null);
    return ids;
  });
}

/** 下のタブを開く */
export async function openTab(page: Page, label: string): Promise<void> {
  await enterEditor(page);
  // 写真モードは操作だけでタブの帯が無い（背景の操作は写真の右上の［⋯］）。操作を開くときは何もしない
  const tab = page.locator('.sheet__tab', { hasText: label });
  if (label === '操作' && !(await tab.isVisible())) return;
  await tab.click();
}

/**
 * 保存した背景と部屋の一覧（ホーム）が出ていれば、最初のタイル（無ければ ＋ から「新しい背景」）を押して編集の画面へ。
 * 背景も部屋も無い初めての起動は、一覧を経ず編集の画面から始まるので何もしない
 */
export async function enterEditor(page: Page): Promise<void> {
  const list = page.locator('.scenes');
  if (!(await list.isVisible())) return;
  const tile = list.locator('.scene-tile__button').first();
  if (await tile.count()) await tile.click();
  else await createFromHome(page, 'photo');
  await list.waitFor({ state: 'hidden' });
}

/** ホームの ＋ から「新しい背景」（部屋なら「新しい部屋」）を選んで作る */
export async function createFromHome(page: Page, kind: 'photo' | 'room'): Promise<void> {
  await page.locator('.scenes .foot__add').click();
  await page.locator('.popup:visible .popup__row', { hasText: kind === 'photo' ? '新しい背景' : '新しい部屋' }).click();
}

/** 編集の画面のヘッダーの ‹ でホームへ */
export async function leaveToHome(page: Page): Promise<void> {
  await page.locator('.scene-header__back').click();
  await page.locator('.scenes').waitFor();
}

/**
 * 描いているカメラを捕まえる。開く前に呼ぶ。
 * three.js の開発者向けの合図（__THREE_DEVTOOLS__）で描画器を受け取り、render に渡るカメラを window.__camera に控える。
 * 家具が画面のどこに、どの大きさで写るかを、描画と同じカメラで計算するために使う
 */
export async function captureCamera(page: Page): Promise<void> {
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
}

/** 置いた家具の足元と上面の中心が写る画面の点（-1〜1）と、画面に写る高さ（画面の高さに対する割合） */
export async function furnitureOnScreen(page: Page, id: string): Promise<{ foot: [number, number]; heightShare: number }> {
  return page.evaluate(async (id) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const { activeScene } = await import('/src/core/mode.ts');
    const camera = (window as unknown as { __camera: { position: { clone(): { set(x: number, y: number, z: number): { project(c: unknown): { x: number; y: number } } } } } }).__camera;
    const item = activeScene().state().furniture.find((f) => f.id === id)!;
    const project = (x: number, y: number, z: number) => camera.position.clone().set(x, y, z).project(camera);
    const foot = project(...item.position);
    const top = project(item.position[0], item.position[1] + item.size[1], item.position[2]);
    return { foot: [foot.x, foot.y], heightShare: Math.abs(top.y - foot.y) / 2 };
  }, id);
}
