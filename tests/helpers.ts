import type { Page } from '@playwright/test';

/**
 * アプリを開き、置き場（いまのモードの家具の一覧）に、切り抜きの画像を持つ家具を 2 つ置く。
 * 何も選んでいない状態にして、置いた家具の id を返す
 */
export async function openWithTwoCutouts(page: Page): Promise<string[]> {
  await page.goto('/');
  await page.locator('.sheet__tab').first().waitFor();
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
  await page.locator('.sheet__tab', { hasText: label }).click();
}
