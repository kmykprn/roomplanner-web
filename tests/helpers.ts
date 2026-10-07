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
 * 保存した背景と部屋の一覧（最初の画面）が出ていれば、最初のタイル（無ければ ＋）を押して編集の画面へ
 */
export async function enterEditor(page: Page): Promise<void> {
  const list = page.locator('.scenes');
  if (!(await list.isVisible())) return;
  const tile = list.locator('.scene-tile__button').first();
  if (await tile.count()) await tile.click();
  else await list.locator('.scene-tile--add').click();
  await list.waitFor({ state: 'hidden' });
}
