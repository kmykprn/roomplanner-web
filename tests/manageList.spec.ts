import { expect, test } from '@playwright/test';
import { openTab, openWithTwoCutouts } from './helpers';

/**
 * 操作タブの家具の一覧は、家具を動かしても作り直さない。
 * 作り直すと、アイコンを読み直す間だけ枠が空になり、動かしている間ずっとチラつく（PR #129）
 */
test('選んでいない家具を動かしても、一覧のアイコンが消えない', async ({ page }) => {
  const [id] = await openWithTwoCutouts(page);
  await openTab(page, '操作');
  const icons = page.locator('.manage__icon');
  await expect(icons).toHaveCount(2);
  // アイコンの画像が出るまで待つ
  await expect.poll(() => icons.first().evaluate((icon) => icon.style.backgroundImage)).not.toBe('');

  const result = await page.evaluate(async (movingId) => {
    const { activeScene } = await import('/src/core/mode.ts');
    const scene = activeScene();
    const firstIcon = document.querySelector('.manage__icon');
    // 動かしている間に、アイコンの枠が空になった回数を数える
    let emptied = 0;
    const observer = new MutationObserver(() => {
      document.querySelectorAll<HTMLElement>('.manage__icon').forEach((icon) => {
        if (icon.style.backgroundImage === '') emptied += 1;
      });
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
    for (let step = 0; step < 30; step += 1) {
      const item = scene.state().furniture.find((f) => f.id === movingId)!;
      scene.update(movingId, { position: [item.position[0] + 0.01, item.position[1], item.position[2]] });
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    observer.disconnect();
    return { emptied, sameIcon: firstIcon === document.querySelector('.manage__icon') };
  }, id);

  expect(result.emptied).toBe(0);
  expect(result.sameIcon).toBe(true);
});

test('一覧の中身が変わったら、一覧を描き直す', async ({ page }) => {
  const [id] = await openWithTwoCutouts(page);
  await openTab(page, '操作');
  await expect(page.locator('.manage__item')).toHaveCount(2);
  await page.evaluate(async (renamedId) => {
    const { activeScene } = await import('/src/core/mode.ts');
    activeScene().update(renamedId, { name: '名前を変えた' });
  }, id);
  await expect(page.locator('.manage__item .manage__name').first()).toHaveText('名前を変えた');
});
