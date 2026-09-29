import { defineConfig, devices } from '@playwright/test';

/**
 * 画面のテスト（npm test）。開発用のサーバーでアプリを開き、実際のブラウザで確かめる。
 *
 * 開発用のサーバーを使うのは、テストの中から `import('/src/...')` でアプリの状態に触るため。
 * 同じ URL から読み込むので、アプリが使っているのと同じ状態を操作できる。
 * GitHub では PR と main への push で動く（.github/workflows/test.yml）
 */
const PORT = 5299;

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    // スマホの縦長の画面（下のタブが出る大きさ）
    viewport: { width: 500, height: 800 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 500, height: 800 } } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
