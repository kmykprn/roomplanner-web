/**
 * 家具を並べる「場」の共通部分。
 *
 * 部屋モードと写真モードは、**背景（部屋の壁／写真）と、置ける範囲が違うだけ**で、
 * 「足す・消す・動かす・選ぶ」はまったく同じ処理になる。
 * その同じ部分をここに置き、違う部分（置き場所の決め方・移動の制限）だけを
 * 呼び出し側から渡す形にしてある。
 *
 * こうしておくと UI とドラッグ操作は `EditableScene` だけを見ればよく、
 * いま部屋と写真のどちらを触っているかを知らずに済む。
 */

import type { Store } from '@/core/store';
import type { PlacedFurniture } from '@/config/furniture';

/** どのモードの状態にも必ず入っているもの */
export interface FurnitureSceneState {
  furniture: PlacedFurniture[];
  /** 選択中の家具の ID。未選択なら null */
  selectedId: string | null;
}

/** モードごとに違う決まりごと */
export interface SceneRules {
  /** 新しい家具を置く床の座標を決める */
  placementFor(size: [number, number, number]): [number, number, number];
  /** ドラッグの移動先を、そのモードの制限に丸める */
  constrain(
    position: [number, number, number],
    size: [number, number, number],
    rotationY: number
  ): [number, number, number];
}

/** 家具の置き場。UI とドラッグ操作はこの形だけを見る */
export interface EditableScene extends SceneRules {
  state(): FurnitureSceneState;
  /** 変化を購読する。戻り値を呼ぶと解除 */
  subscribe(listener: () => void): () => void;
  add(item: PlacedFurniture): void;
  remove(id: string): void;
  update(id: string, patch: Partial<PlacedFurniture>): void;
  select(id: string | null): void;
}

/**
 * 既存の store を家具の置き場として扱えるようにする。
 *
 * store を作らずに受け取るのは、モードごとに持ちたいものが違うため
 * （部屋は `room`、写真は背景画像）。共通部分だけをここが受け持つ。
 */
export function createFurnitureScene<T extends FurnitureSceneState>(
  store: Store<T>,
  rules: SceneRules
): EditableScene {
  // T は FurnitureSceneState を必ず含むので、この2つのキーだけを渡すのは安全。
  // 総称型のままでは TypeScript がそれを確かめられないため、ここで明示する
  const patch = (next: Partial<FurnitureSceneState>): void => store.set(next as Partial<T>);

  return {
    ...rules,

    state: () => store.get(),
    subscribe: (listener) => store.subscribe(() => listener()),

    add(item) {
      patch({ furniture: [...store.get().furniture, item] });
    },

    remove(id) {
      const { furniture, selectedId } = store.get();
      patch({
        furniture: furniture.filter((item) => item.id !== id),
        selectedId: selectedId === id ? null : selectedId,
      });
    },

    update(id, item) {
      patch({
        furniture: store.get().furniture.map((f) => (f.id === id ? { ...f, ...item } : f)),
      });
    },

    select(id) {
      patch({ selectedId: id });
    },
  };
}

/**
 * 新しい家具を置ける床の座標を探す。
 *
 * 全部を原点に置くと既存の家具に埋まって見えなくなるので、
 * 中央から外側へ向かって格子状に候補を試し、
 * 既存の家具と重ならない最初の場所を返す。
 * 空きが見つからない場合は中央に置く（重なっても操作は可能なため）。
 *
 * `limit` を渡すとその範囲からはみ出す候補を除く（部屋の壁）。
 * 渡さなければ制限なし。**写真モードには壁が無い。**
 */
export function findFreeSpot(
  furniture: PlacedFurniture[],
  size: [number, number, number],
  options: { limit?: { halfWidth: number; halfDepth: number } } = {}
): [number, number, number] {
  const { limit } = options;
  const [width, , depth] = size;

  const STEP = 0.5; // 候補を探す間隔（メートル）
  // 制限が無いときは無限に広がってしまうので、探す範囲を決め打ちで区切る
  const maxRings = limit
    ? Math.ceil(Math.max(limit.halfWidth, limit.halfDepth) / STEP)
    : 8;

  for (let ring = 0; ring <= maxRings; ring++) {
    for (const [gridX, gridZ] of ringOffsets(ring)) {
      const x = gridX * STEP;
      const z = gridZ * STEP;

      // 家具が範囲からはみ出す候補は除外する（新規設置なので回転は 0）
      if (limit && Math.abs(x) + width / 2 > limit.halfWidth) continue;
      if (limit && Math.abs(z) + depth / 2 > limit.halfDepth) continue;

      const overlaps = furniture.some((other) =>
        isOverlapping(x, z, width, depth, other.position[0], other.position[2], other.size[0], other.size[2])
      );
      if (!overlaps) return [x, 0, z];
    }
  }

  return [0, 0, 0];
}

/** 中央から距離 ring にある格子点を列挙する（ring = 0 なら中央のみ） */
function ringOffsets(ring: number): Array<[number, number]> {
  if (ring === 0) return [[0, 0]];

  const offsets: Array<[number, number]> = [];
  for (let x = -ring; x <= ring; x++) {
    for (let z = -ring; z <= ring; z++) {
      // 内側の輪は前の ring で調べ済みなので、外周だけを見る
      if (Math.max(Math.abs(x), Math.abs(z)) === ring) offsets.push([x, z]);
    }
  }
  return offsets;
}

/** 2 つの家具を上から見た長方形として、重なっているかを判定する */
function isOverlapping(
  x1: number, z1: number, w1: number, d1: number,
  x2: number, z2: number, w2: number, d2: number
): boolean {
  return Math.abs(x1 - x2) < (w1 + w2) / 2 && Math.abs(z1 - z2) < (d1 + d2) / 2;
}
