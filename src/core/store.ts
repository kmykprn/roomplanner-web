/**
 * 最小の状態管理。zustand の代わり。
 *
 * React がないので「再レンダリング」という概念が要らず、
 * 「値が変わったら購読者に知らせる」だけで足りる。
 * v4 では 9 個の store に約 1,000 行あったが、仕組み自体はこれで済む。
 */

type Listener<T> = (state: T) => void;

export interface Store<T> {
  get(): T;
  /** 部分更新。変更後の全体を購読者に通知する */
  set(patch: Partial<T> | ((prev: T) => Partial<T>)): void;
  /** 購読する。戻り値を呼ぶと解除 */
  subscribe(listener: Listener<T>): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();

  return {
    get: () => state,

    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      for (const listener of listeners) listener(state);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
