/**
 * アプリ全体のカラーテーマ（roomplanner-v4 の仕様を踏襲）
 */
export const THEME = {
  primary: '#0a7ea4', // メインカラー（青）
  text: '#11181C', // テキスト（濃いグレー）
  background: '#f5f5f5', // 背景（白に近いグレー）
} as const;

/** 3D シーン側の既定色 */
export const SCENE_COLORS = {
  floor: '#c8a882',
  wall: '#ffffff',
  /** 壁の輪郭線。壁どうしの境目と床際を示す */
  wallEdge: '#cfcabf',
  selection: '#0a7ea4', // 選択中の家具の枠線
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
