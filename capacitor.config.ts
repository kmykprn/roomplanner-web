import type { CapacitorConfig } from '@capacitor/cli';

/**
 * iOS アプリ（Capacitor）の設定。
 *
 * Web と同じ dist/ を WKWebView に読ませる。ビルドは `npm run build:app`（Service Worker を切る）。
 * Bundle ID は App Store に出したあとは変えられない（CLAUDE.md「ネイティブ依存の扱い」）。
 */
const config: CapacitorConfig = {
  appId: 'io.github.kmykprn.roomplanner',
  appName: 'RoomPlanner',
  webDir: 'dist',
  // SPM でパッケージ名が衝突するのを避ける（@capacitor-firebase/authentication の README）
  experimental: {
    ios: { spm: { packageOptions: { '@capacitor-firebase/authentication': { symlink: true } } } },
  },
  plugins: {
    FirebaseAuthentication: {
      // ネイティブの SDK にはログインさせず、取れた資格情報を Web の Firebase SDK に渡す。
      // セッションを 1 つ（Web 側）にして、匿名からの昇格（uid を保つ）を今の流れのまま使うため
      skipNativeAuth: true,
      providers: ['google.com', 'apple.com'],
    },
  },
};

export default config;
