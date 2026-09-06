import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // Capacitor でネイティブに包むときは相対パス参照が必須になるため、
  // 最初から base を './' にしておく（後から直すと詰まりやすい）
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // スマホの実機から LAN 経由で開けるようにする
    host: true,
    port: 5173,
  },
});
