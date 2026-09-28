/**
 * 3D の作り方（どのモデルで作るか）。
 *
 * サーバーには生成を頼むときだけ渡す（`POST /jobs` の `engine`、Hunyuan3D-2GP の api/SPEC.md）。
 *
 * | | 作り方 | 所要 |
 * |---|---|---|
 * | `trellis` | **いつもこれ。** 切り抜きからのみ。速くて安い | 約 2 分 |
 * | `hunyuan` | 写真からでも切り抜きからでも作れる。時間はかかるが裏側まで作る | 約 8 分 |
 *
 * 以前は画面で選べたが、速いほうに決めた（選ばせる意味が無かった）。
 * 端末に残っている以前の選択（roomplanner.engine）は読まない。
 * 型に hunyuan を残すのは、その作り方で頼んだ作成中の記録を読み戻すため
 */

export type Engine = 'hunyuan' | 'trellis';

/** 生成を頼むときの作り方 */
export function currentEngine(): Engine {
  return 'trellis';
}
