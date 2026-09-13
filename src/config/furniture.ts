/**
 * 家具の種類定義（roomplanner-v4 の constants/furnitureTypes.ts から移植）
 *
 * v4 では image に require() を使っていたが、Web では不要なので落としている。
 * GLB を使う家具は modelPath に public/ からの相対 URL を入れる想定。
 */

export interface FurnitureType {
  id: string;
  name: string;
  color: string;
  /** [幅(X), 高さ(Y), 奥行き(Z)] メートル */
  defaultSize: [number, number, number];
  /** GLB を使う場合のパス。未指定なら箱で描画する */
  modelPath?: string;
}

export const FURNITURE_TYPES: FurnitureType[] = [
  { id: 'chair', name: '椅子', color: '#debb9b', defaultSize: [0.5, 0.8, 0.5], modelPath: 'models/chair.glb' },
  { id: 'table', name: 'テーブル', color: '#453122', defaultSize: [1.2, 0.8, 0.8] },
  { id: 'sofa', name: 'ソファ', color: '#c4c2c3', defaultSize: [2, 1, 0.9] },
  { id: 'bed', name: 'ベッド', color: '#e8dbd2', defaultSize: [1, 0.5, 2] },
  { id: 'desk', name: 'デスク', color: '#D2691E', defaultSize: [1.5, 0.8, 0.8] },
  { id: 'refrigerator', name: '冷蔵庫', color: '#E0E0E0', defaultSize: [0.6, 1.8, 0.65] },
  { id: 'pillar-box', name: '柱（直方体）', color: '#E0E0E0', defaultSize: [0.3, 2.5, 0.3] },
];

export function findFurnitureType(id: string): FurnitureType | undefined {
  return FURNITURE_TYPES.find((t) => t.id === id);
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
