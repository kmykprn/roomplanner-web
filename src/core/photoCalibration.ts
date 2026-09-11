/**
 * 写真に写っている床から、その写真を撮ったカメラを割り出す。
 *
 * ## 何をしているか
 *
 * 床の上の長方形（ラグ、タイル、フローリングの見切り、部屋の隅）を四角で囲うと、
 * 向かい合う辺を延長した先が**消失点**になる。床の2方向は直交しているので、
 * 2つの消失点から**画角**が決まり、画角が決まれば**カメラの向き**が決まる。
 * 最後に「この四角は実際に何メートルか」を当てると**カメラの高さ**が決まる。
 *
 * 得られるのは `{ 画角・高さ・俯角・向き }`。これは写真モードのカメラが元から
 * 持っていた4つの値そのもので、固定値だったものを計算で埋めることになる。
 *
 * ## 片方の消失点が無限遠に飛ぶ場合
 *
 * **これは例外ではなく主要ケース。** 部屋を正面から撮った写真で床のラグやタイルを
 * 囲うと、手前と奥の辺は画面と平行になり、交わらない（＝消失点が無限遠）。
 *
 * そうなると画角は計算では出せない。直交条件は消失点どうしの関係でしか使えず、
 * 平行な辺はどんな画角でも平行に写るため、手がかりにならない。
 * その場合は**画角を仮定して**残りを解く。仮定したかどうかは戻り値で分かるように
 * してあるので、呼び出し側が「画角は推定です」と伝えられる。
 *
 * ## three.js を使わない理由
 *
 * ここは純粋な計算なので、3Dのライブラリに依存させない。
 * 依存が無ければ Node から直接呼べて、**答えが分かっている数値で検算できる**。
 */

/** 写真の中の位置。左上が (0,0)、右下が (1,1) */
export interface Point2 {
  x: number;
  y: number;
}

export type Vec3 = [number, number, number];

/**
 * 床の上の長方形を囲う四角。
 *
 * 順番が意味を持つ。`0→1` と `3→2` が同じ方向、`0→3` と `1→2` が別方向の辺になる。
 * **`0→1` の辺を「横幅」として扱う**（実寸を当てる辺）。
 */
export type FloorQuad = [Point2, Point2, Point2, Point2];

export interface FloorCalibration {
  /** 垂直画角（度） */
  fov: number;
  /**
   * 画角を計算ではなく仮定で埋めたか。
   *
   * 片方の消失点が無限遠にあるとき（正面から撮った写真でよく起きる）に true。
   * 向きと高さはその画角を前提にした値になるので、画面でそう伝える必要がある。
   */
  fovAssumed: boolean;
  position: Vec3;
  /** カメラの向き。3つの軸を世界座標で表したもの */
  right: Vec3;
  up: Vec3;
  back: Vec3;
}

/**
 * 受け付ける画角の範囲（度）。
 *
 * ここを外れる値は、四角がねじれているか、角が近すぎて数値が暴れている。
 * 実在のカメラなら魚眼でも超望遠でもこの範囲に収まる。
 */
const MIN_FOV = 20;
const MAX_FOV = 120;

/** 0 と見なす閾値。ベクトルの長さや外積の判定に使う */
const EPSILON = 1e-6;

/**
 * 消失点が遠すぎるとみなす距離（画像の高さの半分を 1 とした単位）。
 *
 * 遠い消失点は、角をわずかに動かしただけで位置が大きく変わる。そこから画角を
 * 計算すると値が暴れるので、**一定より遠ければ無限遠（平行）として扱う**。
 */
const VANISHING_FAR = 30;

/**
 * 四角からカメラを割り出す。**割り出せない形なら null を返す。**
 *
 * 角をドラッグしている最中は、ねじれた四角や潰れた四角を必ず通る。
 * そこで無理に値を出すとカメラが飛ぶので、呼び出し側が直前の値を保てるように
 * 「出せない」を返せる形にしてある。
 *
 * @param quad         写真の中の四角（0〜1 の正規化座標）
 * @param aspect       写真の縦横比（幅 ÷ 高さ）
 * @param widthMeters  四角の `0→1` の辺の実寸（メートル）
 */
export function calibrateFloor(
  quad: FloorQuad,
  aspect: number,
  widthMeters: number,
  assumedFov: number
): FloorCalibration | null {
  if (!(aspect > 0) || !(widthMeters > 0) || !(assumedFov > 0)) return null;

  const points = quad.map((corner) => toImagePlane(corner, aspect));

  // 向かい合う辺の組それぞれについて、消失点（または平行な向き）を取る
  const alongWidth = vanishingOf(points[0], points[1], points[3], points[2]);
  const alongDepth = vanishingOf(points[0], points[3], points[1], points[2]);
  if (!alongWidth || !alongDepth) return null;

  const focal = focalLength(alongWidth, alongDepth, assumedFov);
  if (!focal) return null;

  // 消失点への向きが、そのまま床の辺の向き（カメラから見た向き）になる
  const axisWidth = axisToward(alongWidth, points[0], points[1], focal.value);
  const axisDepth = axisToward(alongDepth, points[0], points[3], focal.value);
  if (!axisWidth || !axisDepth) return null;

  // 画角を仮定した場合、2つの向きは厳密には直交しない。
  // 平行な辺から得た向きは画角に左右されないので、そちらを信じて残りを直す
  const alignment = axisWidth[0] * axisDepth[0] + axisWidth[1] * axisDepth[1] + axisWidth[2] * axisDepth[2];
  const widthAxis = alongWidth.finite
    ? orthogonalize(axisWidth, axisDepth, alignment)
    : axisWidth;
  const depthAxis = alongWidth.finite
    ? axisDepth
    : orthogonalize(axisDepth, axisWidth, alignment);
  if (!widthAxis || !depthAxis) return null;

  const fov = (2 * Math.atan(1 / focal.value) * 180) / Math.PI;

  // 四角の回り方によっては床を裏から見る形になる。そのときは横幅の向きを反転させる
  // （法線は外積から出るので、片方を反転させれば上下が入れ替わる）
  return (
    solve(points, widthAxis, depthAxis, focal, fov, widthMeters) ??
    solve(points, negate(widthAxis), depthAxis, focal, fov, widthMeters)
  );
}

/** 消失点。遠すぎる場合と平行な場合は「向き」として扱う */
type Vanishing =
  | { finite: true; point: Point2 }
  | { finite: false; direction: Point2 };

/**
 * 向かい合う2辺から消失点を取る。
 *
 * 交わらない、または遠すぎるときは**辺の向き**を返す。遠い消失点をそのまま使うと、
 * 角をわずかに動かしただけで画角が跳ねる。
 */
function vanishingOf(a1: Point2, a2: Point2, b1: Point2, b2: Point2): Vanishing | null {
  const point = intersection(a1, a2, b1, b2);
  if (point && Math.hypot(point.x, point.y) <= VANISHING_FAR) {
    return { finite: true, point };
  }

  const length = Math.hypot(a2.x - a1.x, a2.y - a1.y);
  if (!(length > EPSILON)) return null;
  return { finite: false, direction: { x: (a2.x - a1.x) / length, y: (a2.y - a1.y) / length } };
}

/**
 * 焦点距離。**2つとも消失点が取れたときだけ計算で出せる。**
 *
 * 床の2方向は直交しているので、`(v1 - 主点)・(v2 - 主点) + f² = 0` が成り立つ。
 * 主点は画像の中心に置いてあるので、そのまま内積を取ればよい。
 * 片方が平行なときは手がかりが無いので、渡された画角から求める。
 */
function focalLength(
  a: Vanishing,
  b: Vanishing,
  assumedFov: number
): { value: number; assumed: boolean } | null {
  if (!a.finite && !b.finite) return null; // 両方平行。床を真上から見た形で、解けない

  if (a.finite && b.finite) {
    const squared = -(a.point.x * b.point.x + a.point.y * b.point.y);
    if (!(squared > 0)) return null;

    const value = Math.sqrt(squared);
    const fov = (2 * Math.atan(1 / value) * 180) / Math.PI;
    // 実在のカメラなら魚眼でも超望遠でもこの範囲に収まる。外れていれば四角が歪んでいる
    if (fov < MIN_FOV || fov > MAX_FOV) return null;
    return { value, assumed: false };
  }

  return { value: 1 / Math.tan((assumedFov * Math.PI) / 360), assumed: true };
}

/** 消失点（または平行な向き）から、床の辺の向きを取る。辺の進む向きに合わせる */
function axisToward(vanishing: Vanishing, from: Point2, to: Point2, focal: number): Vec3 | null {
  const edge = { x: to.x - from.x, y: to.y - from.y };

  if (!vanishing.finite) {
    // 無限遠へ向かう向きは、画像平面に平行な向き（奥行き成分を持たない）になる
    const sign = edge.x * vanishing.direction.x + edge.y * vanishing.direction.y >= 0 ? 1 : -1;
    return normalize([sign * vanishing.direction.x, sign * vanishing.direction.y, 0]);
  }

  const toVanishing = { x: vanishing.point.x - from.x, y: vanishing.point.y - from.y };
  const sign = edge.x * toVanishing.x + edge.y * toVanishing.y >= 0 ? 1 : -1;

  // カメラは -Z を向いているので、画像平面は -focal の位置にある
  return normalize([sign * vanishing.point.x, sign * vanishing.point.y, -sign * focal]);
}

/** `reference` に直交する成分だけを残す。`dot` は2つの内積 */
function orthogonalize(target: Vec3, reference: Vec3, dot: number): Vec3 | null {
  return normalize([
    target[0] - reference[0] * dot,
    target[1] - reference[1] * dot,
    target[2] - reference[2] * dot,
  ]);
}

/** 向きが決まったあとの組み立て。床に届かない向きなら null */
function solve(
  points: Point2[],
  axisWidth: Vec3,
  axisDepth: Vec3,
  focal: { value: number; assumed: boolean },
  fov: number,
  widthMeters: number
): FloorCalibration | null {
  // 床の法線。world の X を横幅・Z を奥行きに取ったときの Y にあたる。
  // 右手系を保つため cross(奥行き, 横幅) の順で取る
  const normal = cross(axisDepth, axisWidth);

  // カメラの各軸を世界座標で表したもの（上の3つを転置したもの）
  const right: Vec3 = [axisWidth[0], normal[0], axisDepth[0]];
  const up: Vec3 = [axisWidth[1], normal[1], axisDepth[1]];
  const back: Vec3 = [axisWidth[2], normal[2], axisDepth[2]];

  // 高さ 1m の仮のカメラで床に落としてみて、四角が何メートルになるか測る。
  // 実寸との比がそのままカメラの高さになる（床までの距離と大きさは比例するため）
  const floorPoints: Vec3[] = [];
  for (const point of points) {
    const hit = projectToFloor(point, focal.value, right, up, back);
    if (!hit) return null;
    floorPoints.push(hit);
  }

  const provisionalWidth = distanceXZ(floorPoints[0], floorPoints[1]);
  if (!(provisionalWidth > EPSILON)) return null;

  const height = widthMeters / provisionalWidth;

  // 四角の中心を原点に置く。こうすると、家具を原点付近に出したときに
  // 合わせた床の上に現れる
  const centerX = (floorPoints[0][0] + floorPoints[1][0] + floorPoints[2][0] + floorPoints[3][0]) / 4;
  const centerZ = (floorPoints[0][2] + floorPoints[1][2] + floorPoints[2][2] + floorPoints[3][2]) / 4;

  return {
    fov,
    fovAssumed: focal.assumed,
    position: [-centerX * height, height, -centerZ * height],
    right,
    up,
    back,
  };
}

/** 写真の中の位置を、画像平面の座標に直す（中心が原点、上下が ±1、左右が ±縦横比） */
function toImagePlane(corner: Point2, aspect: number): Point2 {
  return { x: (corner.x - 0.5) * 2 * aspect, y: (0.5 - corner.y) * 2 };
}

/** 2直線の交点。平行に近ければ null */
function intersection(a1: Point2, a2: Point2, b1: Point2, b2: Point2): Point2 | null {
  const a = { x: a2.x - a1.x, y: a2.y - a1.y };
  const b = { x: b2.x - b1.x, y: b2.y - b1.y };
  const denominator = a.x * b.y - a.y * b.x;
  if (Math.abs(denominator) < EPSILON) return null;

  const t = ((b1.x - a1.x) * b.y - (b1.y - a1.y) * b.x) / denominator;
  return { x: a1.x + a.x * t, y: a1.y + a.y * t };
}

/** 高さ 1m のカメラから画像上の点を床（y = 0）へ落とす。届かなければ null */
function projectToFloor(
  point: Point2,
  focal: number,
  right: Vec3,
  up: Vec3,
  back: Vec3
): Vec3 | null {
  // 画像上の点へ向かう光線を、世界座標に直す
  const direction: Vec3 = [
    point.x * right[0] + point.y * up[0] - focal * back[0],
    point.x * right[1] + point.y * up[1] - focal * back[1],
    point.x * right[2] + point.y * up[2] - focal * back[2],
  ];

  // 下を向いていなければ床に当たらない（地平線より上を指している）
  if (direction[1] >= -EPSILON) return null;

  // カメラは (0, 1, 0) にある。そこから t だけ進むと y = 0 に着く
  const t = -1 / direction[1];
  return [direction[0] * t, 0, direction[2] * t];
}

function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function negate(v: Vec3): Vec3 {
  return [-v[0], -v[1], -v[2]];
}

function normalize(v: Vec3): Vec3 | null {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!(length > EPSILON)) return null;
  return [v[0] / length, v[1] / length, v[2] / length];
}
