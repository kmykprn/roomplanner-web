/**
 * 家具の種類定義。
 *
 * 基本の家具。どれも GLB モデルとタイルの画像を持つ（public/models/）。
 */

export interface FurnitureType {
  id: string;
  name: string;
  /** モデルが読めるまでの仮の箱の色 */
  color: string;
  /** [幅(X), 高さ(Y), 奥行き(Z)] メートル。モデルの外形と同じ比にしておく（縦横比を保って収めるため） */
  defaultSize: [number, number, number];
  /** GLB のパス（public/ からの相対）。未指定なら箱で描画する */
  modelPath?: string;
  /** 一覧のタイルに出す画像（public/ からの相対）。無ければ色の四角 */
  thumbnail?: string;
}

/**
 * 基本の家具。
 *
 * モデルは自前で作ったもの: 画像生成（SDXL）で「白背景の商品写真」風の画像を作り、
 * 自前の 3D 生成（Hunyuan3D-2GP、背景除去は BiRefNet）に通した。第三者の写真・意匠は
 * 使っていない（作り方は README「基本の家具について」）。タイルの画像はモデルを描いたもの
 */
const basic = (id: string, name: string, color: string, defaultSize: [number, number, number]): FurnitureType => ({
  id, name, color, defaultSize, modelPath: `models/${id}.glb`, thumbnail: `models/thumbs/${id}.webp`,
});

export const FURNITURE_TYPES: FurnitureType[] = [
  basic('chair', '椅子', '#b0803f', [0.46, 0.9, 0.5]),
  basic('sofa', 'ソファ', '#5f7382', [1.6, 0.85, 0.85]),
];

export function findFurnitureType(id: string): FurnitureType | undefined {
  return FURNITURE_TYPES.find((t) => t.id === id);
}

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
  typeId: string; // FurnitureType.id
  position: [number, number, number]; // 底面基準。床置きなら y = 0
  rotationY: number; // ラジアン
  size: [number, number, number];
  color: string;
  /**
   * 写真から生成したモデルの置き場（`modelCache` のキー）。
   *
   * FURNITURE_TYPES は静的な一覧なので、生成した家具はそこに載らない。
   * この値があるときは種類ではなくこちらを見る。
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
   * 3D モデルには効かない（3D は rotationY で向きを変える）
   */
  tilt?: number;
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
