/**
 * 3D を作る回数（お試しと回数券）。値はサーバーと同じにする（Hunyuan3D-2GP の api/main.py の TRIAL_COUNT と、api/apple.py の PRODUCTS）。
 * 価格は App Store Connect で付ける（ここの円は一覧に出すための写し。App Store の購入を作ったら、StoreKit が返す価格に替える）
 */

/** ログインすると作れるお試しの回数（アカウントの生涯で） */
export const TRIAL_GENERATIONS = 3;

/** 回数券。商品 ID は App Store Connect の消耗型の商品と同じ */
export const TICKETS: ReadonlyArray<{ productId: string; generations: number; yen: number }> = [
  { productId: 'io.github.kmykprn.roomplanner.credits10', generations: 10, yen: 120 },
  { productId: 'io.github.kmykprn.roomplanner.credits30', generations: 30, yen: 300 },
  { productId: 'io.github.kmykprn.roomplanner.credits80', generations: 80, yen: 600 },
];
