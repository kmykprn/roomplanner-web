import { expect, test } from '@playwright/test';

/**
 * 写真モードで影を受ける面は、3D の家具の足元にだけ敷く。
 * 切り抜きの板（2D）の足元に敷くと、真上に持ち上げた 3D の家具の影を拾い、影が 2 つに見えた
 */
test('影を受ける面は、3D の家具にだけ敷き、2D の家具には敷かない', async ({ page }) => {
  await page.goto('/');
  const grounds = await page.evaluate(async () => {
    const { groundsOf } = await import('/src/scene/photoShadow.ts');
    const base = { typeId: 'generated', color: '#888888', size: [1, 0.8, 0.9] as [number, number, number], rotationY: 0 };
    return groundsOf([
      // 3D の家具（持ち上げてある）
      { ...base, id: 'solid', modelUrl: 'sofa.glb', position: [0.8, 0.45, 0.1] },
      // 2D の家具（その真下の床）
      { ...base, id: 'flat', imageUrl: 'chair.webp', position: [0.5, 0, 0.3] },
      // 3D と 2D の両方を持つ家具は 3D で描くので、面を敷く
      { ...base, id: 'both', modelUrl: 'table.glb', imageUrl: 'table.webp', position: [-1, 0, 0] },
    ]);
  });
  expect(grounds.map((ground) => ground.position)).toEqual([
    [0.8, 0.45, 0.1],
    [-1, 0, 0],
  ]);
});
