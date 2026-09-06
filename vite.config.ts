import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/**
 * 配信先によってベースパスが変わる。
 *
 *   GitHub Pages … リポジトリ名のサブパス配下（/roomplanner-web/）
 *   Capacitor     … 端末内のファイルを直接開くので相対パス（./）
 *
 * 既定を './' にしておき、Pages へデプロイするときだけ
 * DEPLOY_BASE 環境変数で上書きする（.github/workflows/deploy.yml を参照）。
 */
const base = process.env.DEPLOY_BASE ?? './';

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      // 新しいバージョンを公開したら、次回起動時に自動で入れ替える
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'favicon-32x32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'RoomPlanner',
        short_name: 'RoomPlanner',
        description: '3D で部屋の模様替えを試せるアプリ',
        lang: 'ja',
        // ホーム画面から起動したときにアドレスバーを出さない
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#f5f5f5',
        background_color: '#f5f5f5',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          // Android で丸などの形に切り抜かれる場合に使われる
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // three.js を含むバンドルは既定の上限（2MB）を超えるため引き上げる。
        // ここが足りないとオフライン起動できなくなる
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // スマホの実機から LAN 経由で開けるようにする
    host: true,
    port: 5173,
  },
});
