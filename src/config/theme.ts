/**
 * アプリ全体のカラーテーマ。
 *
 * 黄緑はアプリのアイコン（白い地に黄緑の椅子）の色。2026-10-08 に青（Expo のひな形の既定色）から変えた。
 * 明るい黄緑は白い文字が読みにくいので、ボタンの地などには一段暗い primary を、
 * ＋ の枠や選んでいるタブの文字など、白い地の上の印には accent（アイコンと同じ色）を使う
 */
export const THEME = {
  primary: '#6e9c11', // メインカラー（黄緑。ボタンの地、線、選択の枠）
  accent: '#8bc516', // アイコンと同じ黄緑（白い地の上の印）
  text: '#11181C', // テキスト（濃いグレー）
  background: '#f5f5f5', // 背景（白に近いグレー）
} as const;

/** 3D シーン側の既定色 */
export const SCENE_COLORS = {
  floor: '#c8a882',
  wall: '#ffffff',
  /** 壁の輪郭線。壁どうしの境目と床際を示す */
  wallEdge: '#cfcabf',
  selection: '#6e9c11', // 選択中の家具の枠線（メインカラー）
} as const;

/**
 * 素材の質感。
 *
 * roughness は表面のざらつき（0 = 鏡、1 = 完全につや消し）、
 * metalness は金属かどうか（布や木は 0）。
 * すべて同じ値にすると全部が同じプラスチックに見えるので、
 * 素材ごとに変えることが「リアルさ」に一番効く。
 *
 * 壁はここに含めない。光の影響を受けない材質を使っているため
 * （理由は scene/room.ts の createWall を参照）。
 */
export const SURFACES = {
  /** 木の床。わずかにつやを残すと環境光が映り込んで質感が出る */
  floor: { roughness: 0.55, metalness: 0 },
  /** 家具の既定。布と木の中間くらい */
  furniture: { roughness: 0.7, metalness: 0 },
} as const;
