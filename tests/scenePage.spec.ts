import { expect, test, type Page } from '@playwright/test';
import { createFromHome, leaveToHome } from './helpers';

/**
 * 保存した背景と部屋の一覧（ホーム、ui/scenePage.ts）と、編集の画面のヘッダー（ui/sceneHeader.ts）・下の帯。
 * 背景も部屋も 1 つも無ければ、アプリは新しい背景の編集から始まる。1 つでもあれば背景の一覧から。
 * ホームの下の帯は、左に「背景」「部屋」のタブ、真ん中に ＋（新しく作る）、右に「家具」。一覧は 1 行 2 列。
 * 編集の画面の下の帯は、左端の ← でホームへ、真ん中の ＋ で家具のページ
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('.sheet').first().waitFor();
});

/** 初めての起動は新しい背景の編集から始まる。そこに家具を 1 つ置く */
async function placeChair(page: Page): Promise<void> {
  await expect(page.locator('.scenes')).toBeHidden();
  await page.evaluate(async () => {
    const { photoScene } = await import('/src/core/photoState.ts');
    const size: [number, number, number] = [0.5, 0.9, 0.5];
    photoScene.add({ id: 'c1', typeId: 'box', name: '椅子', color: '#ccc', size, baseSize: size, position: [0, 0, 0], rotationY: 0 });
  });
}

test('初めての起動は新しい背景の編集から。何もせずに戻ると、その空の背景は一覧に残らず、一覧は空', async ({ page }) => {
  await expect(page.locator('.scenes')).toBeHidden();
  await expect(page.locator('.scene-header__name')).toHaveText(/^背景 \d+\/\d+$/);
  await leaveToHome(page);
  await expect(page.locator('.scene-tile__button')).toHaveCount(0);
  // 上の帯（題と切り替え）は無く、下の帯の「背景」が選ばれている
  await expect(page.locator('.scenes__bar')).toHaveCount(0);
  await expect(page.locator('.scenes .foot__tab', { hasText: '背景' })).toHaveClass(/is-active/);
  // 「部屋」にしても 1 つも無ければ空の一覧（案内の文は出さない）
  await page.locator('.scenes .foot__tab', { hasText: '部屋' }).click();
  await expect(page.locator('.scenes .foot__tab', { hasText: '部屋' })).toHaveClass(/is-active/);
  await expect(page.locator('.scene-tile__button')).toHaveCount(0);
  await expect(page.locator('.scenes__body')).toHaveText('');
  // ＋ のメニューから部屋を作る
  await createFromHome(page, 'room');
  await expect(page.locator('.scene-header__name')).toHaveText(/^部屋 \d+\/\d+$/);
  await expect(page.locator('.sheet__tab', { hasText: '内装' })).toBeVisible();
});

test('家具を置いて戻ると一覧にアイコン付きで残り、2 回目は一覧から始まり、押すと開く', async ({ page }) => {
  await placeChair(page);
  await leaveToHome(page);
  await expect(page.locator('.scene-tile__button')).toHaveCount(1);
  await expect.poll(() => page.locator('.scene-tile__img').first().evaluate((e) => e.style.backgroundImage)).toContain('blob:');

  await page.reload();
  await page.locator('.scenes').waitFor();
  await expect(page.locator('.scenes .foot__tab', { hasText: '背景' })).toHaveClass(/is-active/);
  await page.locator('.scene-tile__button').first().click();
  await expect(page.locator('.scenes')).toBeHidden();
  const count = await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().furniture.length);
  expect(count).toBe(1);
});

test('＋ を押すと「新しく作る」が下から出て、暗い所を押すと閉じる。「新しい背景」で作って編集へ', async ({ page }) => {
  await placeChair(page);
  await leaveToHome(page);
  await page.locator('.scenes .foot__add').click();
  const menu = page.getByRole('dialog', { name: '新しく作る' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button')).toHaveText(['新しい背景›', '新しい部屋›']);
  await page.locator('.popup:visible .popup__dim').click({ position: { x: 10, y: 10 } });
  await expect(menu).toBeHidden();
  await createFromHome(page, 'photo');
  await expect(page.locator('.scenes')).toBeHidden();
  await expect(page.locator('.scene-header__name')).toHaveText(/^背景 \d+\/\d+$/);
});

test('名前は編集の画面の名前（鉛筆）からも、一覧の ⋯ からも変えられる', async ({ page }) => {
  await placeChair(page);
  await page.getByRole('button', { name: '名前を変える' }).click();
  await page.getByRole('textbox', { name: '名前' }).fill('リビング');
  await page.getByRole('button', { name: '決定' }).click();
  await expect(page.locator('.scene-header__name')).toHaveText('リビング');

  await leaveToHome(page);
  await expect(page.locator('.scene-tile__name')).toHaveText(['リビング']);
  await page.getByRole('button', { name: 'リビング のメニュー' }).click();
  await page.locator('.bg-menu__sheet:visible').getByRole('button', { name: '名前を変える' }).click();
  await page.getByRole('textbox', { name: '名前' }).fill('寝室');
  await page.getByRole('button', { name: '決定' }).click();
  await expect(page.locator('.scene-tile__name')).toHaveText(['寝室']);
});

test('複製すると「〜のコピー」ができて開く。⋯ の削除で、確認してから消える', async ({ page }) => {
  await placeChair(page);
  await leaveToHome(page);
  const name = (await page.locator('.scene-tile__name').first().textContent())!;
  await page.getByRole('button', { name: `${name} のメニュー` }).click();
  await page.locator('.bg-menu__sheet:visible').getByRole('button', { name: '複製' }).click();
  await expect(page.locator('.scenes')).toBeHidden();
  await expect(page.locator('.scene-header__name')).toHaveText(`${name} のコピー`);
  expect(await page.evaluate(async () => (await import('/src/core/photoState.ts')).photoState.get().furniture.length)).toBe(1);

  await leaveToHome(page);
  await expect(page.locator('.scene-tile__button')).toHaveCount(2);
  const copyMenu = page.getByRole('button', { name: `${name} のコピー のメニュー` });
  await copyMenu.click();
  await page.locator('.bg-menu__sheet:visible').getByRole('button', { name: '削除' }).click();
  const confirm = page.locator('.modal:visible');
  await expect(confirm).toContainText(`「${name} のコピー」を削除します`);
  await expect(confirm).toContainText('この端末から完全に削除します');
  await confirm.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.locator('.scene-tile__button')).toHaveCount(2);
  await copyMenu.click();
  await page.locator('.bg-menu__sheet:visible').getByRole('button', { name: '削除' }).click();
  await page.locator('.modal:visible').getByRole('button', { name: '削除' }).click();
  await expect(page.locator('.scene-tile__button')).toHaveCount(1);
  await expect(page.locator('.scene-tile__name')).toHaveText([name]);
});

test('一覧は作った順（先頭が最新）で固定。古いほうを開いて家具を置いて戻っても、並びは変わらない', async ({ page }) => {
  await placeChair(page);
  await page.getByRole('button', { name: '名前を変える' }).click();
  await page.getByRole('textbox', { name: '名前' }).fill('古い');
  await page.getByRole('button', { name: '決定' }).click();
  await leaveToHome(page);
  await createFromHome(page, 'photo');
  await placeChair(page);
  await page.getByRole('button', { name: '名前を変える' }).click();
  await page.getByRole('textbox', { name: '名前' }).fill('新しい');
  await page.getByRole('button', { name: '決定' }).click();
  await leaveToHome(page);
  await expect(page.locator('.scene-tile__name')).toHaveText(['新しい', '古い']);
  // 古いほうを開いて家具を足して戻る
  await page.getByRole('button', { name: '古い を開く' }).click();
  await page.evaluate(async () => {
    const { photoScene } = await import('/src/core/photoState.ts');
    const size: [number, number, number] = [0.5, 0.9, 0.5];
    photoScene.add({ id: 'c2', typeId: 'box', name: '机', color: '#ccc', size, baseSize: size, position: [1, 0, 0], rotationY: 0 });
  });
  await leaveToHome(page);
  await expect(page.locator('.scene-tile__name')).toHaveText(['新しい', '古い']);
});

test('一覧は 1 行 2 列。上の帯は無く、下の帯のタブと ＋ は共通の大きさ', async ({ page }) => {
  await placeChair(page);
  await leaveToHome(page);
  await createFromHome(page, 'photo');
  await placeChair(page);
  await leaveToHome(page);
  await createFromHome(page, 'photo');
  await placeChair(page);
  await leaveToHome(page);
  const r = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.scene-tile'), (el) => el.getBoundingClientRect());
    const foot = document.querySelector('.scenes .foot')!.getBoundingClientRect();
    const add = document.querySelector('.scenes .foot__add')!.getBoundingClientRect();
    const tabs = Array.from(document.querySelectorAll('.scenes .foot__tab'), (el) => el.textContent);
    return { rows: new Set(tiles.map((t) => Math.round(t.top))).size, firstRowCount: tiles.filter((t) => Math.round(t.top) === Math.round(tiles[0].top)).length, footHeight: foot.height, addWidth: add.width, addCenter: (add.left + add.right) / 2, tabs };
  });
  expect(r.firstRowCount).toBe(2);
  expect(r.rows).toBe(2);
  expect(r.footHeight).toBe(76);
  expect(r.addWidth).toBe(64);
  expect(Math.abs(r.addCenter - 250)).toBeLessThan(1);
  expect(r.tabs).toEqual(['背景', '部屋', '家具']);
});

test('ヘッダーは ‹ と名前（右に鉛筆）。名前は真ん中で ‹ の押せる範囲と重ならず、高さは 53px', async ({ page }) => {
  const r = await page.evaluate(() => {
    const back = document.querySelector('.scene-header__back')!.getBoundingClientRect();
    const name = document.querySelector('.scene-header__name')!.getBoundingClientRect();
    const header = document.querySelector('.header')!.getBoundingClientRect();
    return { backRight: back.right, nameLeft: name.left, nameCenter: (name.left + name.right) / 2, headerCenter: (header.left + header.right) / 2, height: header.height };
  });
  expect(r.nameLeft).toBeGreaterThanOrEqual(r.backRight);
  expect(Math.abs(r.nameCenter - r.headerCenter)).toBeLessThan(1);
  expect(r.height).toBeLessThanOrEqual(56);
  await expect(page.locator('.scene-header__name .ic')).toBeVisible();
});

test('編集の画面に下の帯と浮かぶ ＋ は無い。置いた家具の一覧の「＋ 家具を追加」で開くと ← の帯で「背景に追加」で置ける', async ({ page }) => {
  await expect(page.locator('.foot--editor')).toHaveCount(0);
  await expect(page.locator('.fab--editor')).toHaveCount(0);
  await expect(page.locator('#app > .foot')).toHaveCount(0);
  await page.locator('.manage__add').click();
  const furniture = page.getByRole('dialog', { name: '家具' });
  await expect(furniture).toBeVisible();
  await expect(page.locator('.page .foot:visible .foot__back')).toBeVisible();
  await page.locator('.page .thumb__button', { hasText: 'サンプル 1' }).click();
  await expect(page.locator('.tile-actions__button')).toHaveText('背景に追加');
  await page.locator('.tile-actions__dim').click({ position: { x: 10, y: 10 } });
  await page.locator('.page .foot:visible .foot__back').click();
  await expect(furniture).toBeHidden();
  await placeChair(page);
  await leaveToHome(page);
  await expect(page.locator('.scenes')).toBeVisible();
  await expect(page.locator('.scene-tile__button')).toHaveCount(1);
});

test('ホームの「家具」タブで開いた家具のページは、帯がホームと同じで「背景に追加」は出ない。2D/3D の列と編集は出る', async ({ page }) => {
  await placeChair(page);
  await leaveToHome(page);
  await page.locator('.scenes .foot__tab', { hasText: '家具' }).click();
  const furniture = page.getByRole('dialog', { name: '家具' });
  await expect(furniture).toBeVisible();
  await expect(page.locator('.page .foot:visible .foot__tab', { hasText: '家具' })).toHaveClass(/is-active/);
  await expect(page.locator('.page .foot:visible .foot__back')).toHaveCount(0);
  await page.locator('.page .thumb__button', { hasText: 'サンプル 1' }).click();
  await expect(page.getByRole('group', { name: '置く形' })).toBeVisible();
  await expect(page.locator('.tile-actions__edit')).toBeVisible();
  await expect(page.locator('.tile-actions__button')).toBeHidden();
  await page.locator('.tile-actions__dim').click({ position: { x: 10, y: 10 } });
  // 「部屋」で閉じてホームの部屋の一覧へ。＋ の「新しい部屋」で作って編集へ
  await page.locator('.page .foot:visible .foot__tab', { hasText: '部屋' }).click();
  await expect(furniture).toBeHidden();
  await expect(page.locator('.scenes .foot__tab', { hasText: '部屋' })).toHaveClass(/is-active/);
  await page.locator('.scenes .foot__tab', { hasText: '家具' }).click();
  await page.locator('.page .foot:visible .foot__add').click();
  await page.locator('.popup:visible .popup__row', { hasText: '新しい部屋' }).click();
  await expect(furniture).toBeHidden();
  await expect(page.locator('.scenes')).toBeHidden();
  await expect(page.locator('.scene-header__name')).toHaveText(/^部屋 \d+\/\d+$/);
  await expect(page.locator('.sheet__tab', { hasText: '内装' })).toBeVisible();
});

test('名前を変える欄は画面の上の方にあり、下端が画面の高さの半分より上（キーボードに隠れない）', async ({ page }) => {
  await placeChair(page);
  await page.locator('.scene-header__name').click();
  const dialog = page.getByRole('dialog', { name: '名前を変える' });
  await expect(dialog).toBeVisible();
  const r = await dialog.locator('.modal__box').evaluate((el) => ({ bottom: el.getBoundingClientRect().bottom, inner: window.innerHeight }));
  expect(r.bottom).toBeLessThan(r.inner / 2);
  await dialog.getByRole('button', { name: 'キャンセル' }).click();
  // 削除の確認は真ん中のまま
  await leaveToHome(page);
  await page.locator('.scene-tile__more').first().click();
  await page.locator('.bg-menu__sheet:visible').getByRole('button', { name: '削除' }).click();
  const c = await page.locator('.modal:visible .modal__box').evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { center: (b.top + b.bottom) / 2, inner: window.innerHeight };
  });
  expect(Math.abs(c.center - c.inner / 2)).toBeLessThan(40);
});

test('絵の右下の全画面のボタンでヘッダーとシートが隠れて絵が画面いっぱいになり、もう一度押すと戻る', async ({ page }) => {
  const button = page.locator('.view-full');
  await expect(button).toHaveAttribute('aria-label', '全画面');
  const before = await page.evaluate(() => {
    const b = document.querySelector('.view-full')!.getBoundingClientRect();
    const v = document.querySelector('#viewport')!.getBoundingClientRect();
    const s = getComputedStyle(document.querySelector('.view-full')!);
    return { right: v.right - b.right, bottom: v.bottom - b.bottom, width: b.width, color: s.color, background: s.backgroundColor, viewportHeight: v.height };
  });
  expect(before.right).toBe(12);
  expect(before.bottom).toBe(12);
  expect(before.width).toBe(44);
  expect(before.color).toBe('rgb(110, 156, 17)');
  expect(before.background).toBe('rgba(255, 255, 255, 0.9)');
  await button.click();
  await expect(page.locator('.header')).toBeHidden();
  await expect(page.locator('.sheet')).toBeHidden();
  await expect(button).toHaveAttribute('aria-label', '全画面をやめる');
  const full = await page.evaluate(() => ({ height: document.querySelector('#viewport')!.getBoundingClientRect().height, inner: window.innerHeight }));
  expect(full.height).toBe(full.inner);
  await button.click();
  await expect(page.locator('.header')).toBeVisible();
  await expect(page.locator('.sheet')).toBeVisible();
  const after = await page.evaluate(() => document.querySelector('#viewport')!.getBoundingClientRect().height);
  expect(after).toBe(before.viewportHeight);
});

/** 2:1 の横長の写真（真ん中に赤い正円）を背景にする */
async function setWidePhoto(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 400;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 800, 400);
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(400, 200, 80, 0, Math.PI * 2);
    ctx.fill();
    const { photoState } = await import('/src/core/photoState.ts');
    photoState.set({ backgroundStatus: 'ready', backgroundUrl: canvas.toDataURL(), backgroundAspect: 2, backgroundName: 'wide.png' });
  });
  await page.waitForTimeout(300);
}

test('全画面では写真を切り落とさず全体を収め、余白はアプリの地の色。戻ると元の敷き方', async ({ page }) => {
  await setWidePhoto(page);
  const cover = await page.locator('.viewport__photo').evaluate((el) => el.getBoundingClientRect().width);
  await page.locator('.view-full').click();
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const layer = document.querySelector('.viewport__photo')!.getBoundingClientRect();
    const viewport = document.querySelector('#viewport')!;
    const v = viewport.getBoundingClientRect();
    return { layerW: layer.width, layerH: layer.height, viewW: v.width, viewH: v.height, top: layer.top - v.top, background: getComputedStyle(viewport).backgroundColor, size: (document.querySelector('.viewport__photo') as HTMLElement).style.backgroundSize };
  });
  // 幅いっぱい、高さは幅 ÷ 2。上下に余白があり、写真は層と同じ大きさで敷かれている（切り落とし無し）
  expect(r.layerW).toBe(r.viewW);
  expect(Math.abs(r.layerH - r.viewW / 2)).toBeLessThan(1);
  expect(r.top).toBeGreaterThan(50);
  expect(r.background).toBe('rgb(245, 245, 245)');
  expect(r.size).toBe(`${r.layerW}px ${r.layerH}px`);
  await page.locator('.view-full').click();
  await page.waitForTimeout(300);
  await expect.poll(() => page.locator('.viewport__photo').evaluate((el) => el.getBoundingClientRect().width)).toBe(cover);
});

test('一覧のアイコンは画面と同じ切り取りで、横長の写真の正円は潰れない', async ({ page }) => {
  await setWidePhoto(page);
  const r = await page.evaluate(async () => {
    const { currentScene, snapshotScene, readSceneThumbnail } = await import('/src/core/sceneLibrary.ts');
    const entry = currentScene('photo')!;
    await snapshotScene(entry.id);
    const blob = await readSceneThumbnail(entry.id);
    const bmp = await createImageBitmap(blob!);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (d[i] > 180 && d[i + 1] < 90 && d[i + 2] < 90) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
    return { circleW: maxX - minX + 1, circleH: maxY - minY + 1 };
  });
  expect(r.circleW).toBeGreaterThan(40);
  expect(Math.abs(r.circleW - r.circleH)).toBeLessThanOrEqual(2);
});
