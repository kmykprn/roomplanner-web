/**
 * 3D の作り方（どのモデルで作るか）の設定。
 *
 * 限定公開中の試用のため、既定は従来どおり Hunyuan のまま。端末ごとの設定で、
 * サーバーには生成を頼むときだけ渡す（`POST /jobs` の `engine`、Hunyuan3D-2GP の api/SPEC.md）。
 *
 * | | 作り方 | 所要 |
 * |---|---|---|
 * | `hunyuan` | 既定。写真からでも切り抜きからでも作れる | 約 8 分 |
 * | `trellis` | 試用。**切り抜きからのみ**。速くて安いが、背面が暗くなることがある | 約 2 分 |
 */

export type Engine = 'hunyuan' | 'trellis';

export const ENGINES: readonly { value: Engine; label: string; note: string }[] = [
  { value: 'hunyuan', label: 'ふつう', note: '約 8 分' },
  { value: 'trellis', label: 'お試し（速い）', note: '約 2 分' },
];

const STORAGE_KEY = 'roomplanner.engine';
const DEFAULT: Engine = 'hunyuan';

function isEngine(value: unknown): value is Engine {
  return value === 'hunyuan' || value === 'trellis';
}

/** いまの設定。プライベートモードなどで localStorage が使えないときは既定を返す */
export function currentEngine(): Engine {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isEngine(value) ? value : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function setEngine(engine: Engine): void {
  try {
    localStorage.setItem(STORAGE_KEY, engine);
  } catch {
    // 設定が残らないだけで、この操作自体は成立している（次回起動時は既定に戻る）
  }
}
