/**
 * サーバーが返す工程を、円の進み具合と画面の文言に変える。
 *
 * ## なぜ工程が要るのか
 *
 * 以前はサーバーが `queued` / `running` の2つしか返さず、8分間ずっと
 * `running` のままだった。だから円が表していたのは進捗ではなく
 * **経過時間 ÷ 想定時間** という見込みでしかなかった。
 *
 * いまはサーバーが工程（`phase`）を返す（Hunyuan3D-2GP の api/SPEC.md）ので、
 * **本当にどこまで進んだか**が出せる。
 *
 * ## 円が戻らないようにする
 *
 * 工程は必ず上から順に進む。各工程には**円のうちの持ち分**があり、
 * その中でだけ経過時間で補間する。持ち分を超えたら円はそこで止まる。
 *
 * 止まるのは正直な表示で、実際に長引いているという情報になる。
 * 次の工程に進めば円もまた動き出す。
 */

/** 各工程の実測時間（秒）。円の持ち分はこの比で決まる */
interface Step {
  /** サーバーが返す `phase`。null は「まだ工程が返っていない」＝コンテナ起動待ち */
  readonly phase: string | null;
  readonly seconds: number;
  /** 画面に出す説明。専門用語を出さず、何を待っているのかが分かる言い方にする */
  readonly label: string;
}

const STEPS: readonly Step[] = [
  { phase: null, seconds: 25, label: '順番を待っています' },
  { phase: 'preparing', seconds: 15, label: '写真を読み込んでいます' },
  { phase: 'loading_texture_model', seconds: 185, label: '模様を作る準備をしています' },
  { phase: 'loading_shape_model', seconds: 78, label: '形を作る準備をしています' },
  { phase: 'generating_shape', seconds: 30, label: '形を作っています' },
  { phase: 'generating_texture', seconds: 169, label: '色と模様をつけています' },
  // 成果物の保存は数秒だが、終わったことに画面が気づくのは次に見に行くとき
  // （最大15秒あと）。その待ちも含めておかないと、円が最後で長く止まって見える
  { phase: 'finishing', seconds: 20, label: 'もうすぐできあがります' },
];

/** 全工程の合計。円の持ち分の分母になる */
const TOTAL_SECONDS = STEPS.reduce((sum, step) => sum + step.seconds, 0);

/** 各工程が始まる時点までの累計秒。`STEPS` から一度だけ作る（手で書くとずれる） */
const STARTS_AT: readonly number[] = STEPS.reduce<number[]>((acc, _step, index) => {
  acc.push(index === 0 ? 0 : acc[index - 1] + STEPS[index - 1].seconds);
  return acc;
}, []);

/**
 * 円を満杯にしない上限。
 *
 * 最後の工程（成果物の保存）が長引いたときに満杯で止まると
 * 「終わったはずなのに終わらない」という最悪の見え方になる
 */
const MAX_RATIO = 0.99;

/** 残り時間を数字で出すのをやめる境目 */
const IMMINENT_SECONDS = 60;

export interface Progress {
  /** 0〜1。工程が進む限り増え、同じ工程の中では決して戻らない */
  ratio: number;
  /** 円の中央に出す文字 */
  centerText: string;
  /** いま何をしているか */
  label: string;
}

/**
 * いまの進み具合を求める。
 *
 * @param phase サーバーが返した工程。まだ無ければ null
 * @param elapsedInPhaseSec その工程に入ってからの経過秒
 */
export function progressFor(phase: string | null, elapsedInPhaseSec: number): Progress {
  const index = STEPS.findIndex((step) => step.phase === phase);
  if (index < 0) {
    // 知らない工程。サーバーが工程を増やしても画面が壊れないようにする
    return unknownPhase(phase);
  }

  const step = STEPS[index];
  const within = clamp(elapsedInPhaseSec, 0, step.seconds);
  const done = STARTS_AT[index] + within;

  return {
    ratio: Math.min(done / TOTAL_SECONDS, MAX_RATIO),
    centerText: remainingText(TOTAL_SECONDS - done),
    label: step.label,
  };
}

/**
 * 工程が分からないときの表示。
 *
 * サーバーは工程の書き込みに失敗しても生成を続ける（api/SPEC.md）ので、
 * 工程が来ないまま8分待つことは実際に起こりうる。そのときは何も出さないより、
 * 動いていることだけでも伝えるほうがよい
 */
function unknownPhase(phase: string | null): Progress {
  return {
    ratio: 0,
    centerText: '作成中',
    label: phase ? '作成しています' : '順番を待っています',
  };
}

/**
 * 円の中央に出す残り時間。
 *
 * **これは見込みであって約束ではない。** 1分を切ったら数字を出すのをやめる。
 * 「あと0分」と出したあとまだ続くより、「まもなく」のほうが正直
 */
function remainingText(remainingSec: number): string {
  if (remainingSec < IMMINENT_SECONDS) return 'まもなく';
  return `あと${Math.ceil(remainingSec / 60)}分`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
