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
  wall: '#f0ece4',
  selection: '#0a7ea4', // 選択中の家具の枠線
} as const;
