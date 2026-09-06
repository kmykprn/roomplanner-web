/**
 * assets-src/icon.svg から PWA 用のアイコン一式を書き出す。
 *
 * 生成した PNG は public/ にコミット済みなので、通常このスクリプトを動かす必要はない。
 * アイコンを変更したいときだけ icon.svg を編集して、以下を実行する:
 *
 *   npm i -D sharp && node assets-src/make-icons.mjs && npm uninstall sharp
 *
 * sharp は画像変換にしか使わない重いネイティブ依存なので、
 * 依存関係に常駐させず、必要なときだけ入れる方針にしている。
 */
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const svg = await readFile(new URL('./icon.svg', import.meta.url));

const targets = [
  { file: 'public/pwa-192x192.png', size: 192 },
  { file: 'public/pwa-512x512.png', size: 512 },
  // iOS のホーム画面用。透過に対応しないので背景は塗りつぶし済みのものを使う
  { file: 'public/apple-touch-icon.png', size: 180 },
  { file: 'public/favicon-32x32.png', size: 32 },
];

for (const { file, size } of targets) {
  await sharp(svg).resize(size, size).png().toFile(file);
  console.log(`${file} (${size}x${size})`);
}
