/**
 * 置いた家具の形。
 *
 * 家具の中身は「作った家具」（写真の切り抜き・3D モデル・商品の取り込み）と、
 * 最初から入っているサンプル（config/samples.ts）。どちらも保管庫（core/modelLibrary.ts）の
 * 項目から置く。3D の傾きは pitch（前後）と roll（左右）の 2 つ。
 * 2D の tilt（画面の中で回す）とは別
 */

/**
 * 商品ページから取り込んだ家具の、買うための情報。
 * affiliateUrl は紹介料の付くリンク（楽天アフィリエイト）。画面はこちらを開く
 */
export interface ProductInfo {
  shop: string;
  name: string;
  price: number | null;
  url: string;
  affiliateUrl: string;
}

/** 部屋に配置された家具 1 個ぶんの状態 */
export interface PlacedFurniture {
  id: string; // インスタンス ID
  typeId: string; // 'generated'。古い記録には基本の家具の id（chair など）が残っていることがあり、その場合は箱で描く
  position: [number, number, number]; // 底面基準。床置きなら y = 0
  rotationY: number; // ラジアン
  size: [number, number, number];
  color: string;
  /**
   * 写真から生成したモデルの置き場（`modelCache` のキー）。
   *
   * サンプルは Vite が取り込んだ GLB の URL で、そのまま読める。
   */
  modelUrl?: string;
  /**
   * 写真から切り抜いた透過 PNG の置き場（`cutoutCache` のキー）。
   *
   * これがあるときは板（ビルボード）として描く。modelUrl と両方あれば modelUrl を優先する
   * （切り抜きを後から 3D にしたとき、置いてある家具もそのまま 3D に差し替わる）
   */
  imageUrl?: string;
  /** 商品ページから取り込んだ家具なら、買うための情報。編集の姿と操作タブに「楽天で見る」を出す */
  product?: ProductInfo;
  /**
   * 切り抜きの板の傾き（ラジアン）。画面の中で回す。斜めに撮った写真を水平に直す用途。
   * 3D モデルには効かない（3D は rotationY で向きを変え、pitch で前後に傾ける）
   */
  tilt?: number;
  /** 3D の前後の傾き（X 軸まわり、ラジアン）。正で後ろに倒れる。板には効かない */
  pitch?: number;
  /** 3D の左右の傾き（Z 軸まわり、ラジアン）。正で右に倒れる。板には効かない */
  roll?: number;
  /**
   * 置いたときの大きさ。「初期値に戻す」で戻す先として持っておく。
   *
   * 無い記録（この項目より前に置いた家具）もあるので、読む側は size で代用すること
   */
  baseSize?: [number, number, number];
  /** 生成した家具の表示名。一覧に無い種類なので自前で持つ */
  name?: string;
  /**
   * 生成に使った写真の縮小プレビュー。端末の IndexedDB に保存する。
   *
   * **いまどこにも表示していない。** 家具を消すときに一緒に捨てるために持っている。
   * 消さずに残しているのは、作った家具の一覧（保管機能）でサムネイルに使う
   * 予定があるため
   */
  sourceImageKey?: string;
}
