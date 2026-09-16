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

/** 上に載れる家具の大きさの上限（いちばん長い辺、メートル）。ランプや小物はこれ以下 */
const STACKABLE_MAX_EDGE = 0.6;

/**
 * 家具を (x, z) に動かしたとき、何の上に載るかを見て底面の高さを返す。
 *
 * 真下にある家具のうち、上面がいちばん高いものに載せる。何も無ければ床（0）。
 * 載るのは小さいもの（長辺 60cm 以下）だけで、相手は自分より広いものだけ。
 * 椅子をソファの上に引きずっても跳ね上がらないように、テーブルランプのような
 * 小物が机に載る向きだけにする。
 * 回転は見ない（上から見た外接の長方形で十分。細かい当たりは求めていない）
 */
export function restingHeightAt(
  furniture: PlacedFurniture[],
  item: PlacedFurniture,
  x: number,
  z: number
): number {
  if (Math.max(...item.size) > STACKABLE_MAX_EDGE) return 0;
  let height = 0;
  for (const other of furniture) {
    if (other.id === item.id) continue;
    if (other.size[0] < item.size[0] || other.size[2] < item.size[2]) continue;
    // 自分の中心が相手の上面の中にあるか
    const inside =
      Math.abs(x - other.position[0]) < other.size[0] / 2 &&
      Math.abs(z - other.position[2]) < other.size[2] / 2;
    if (!inside) continue;
    height = Math.max(height, other.position[1] + other.size[1]);
  }
  return height;
}
