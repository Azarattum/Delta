import { add, distinct, zero, type ZSet } from "../datastructure/zset";
import { stream, SyncPromise, type Stream } from "../stream";

export function sink<T>(
  downstream: Stream<ZSet<T> | Promise<ZSet<T>>>,
  initial = zero<T>(),
) {
  let view: Promise<ZSet<T>> | ZSet<T>;
  const pullView = () =>
    (view = SyncPromise.one(downstream.pull()).then((x) => (view = x)));

  return stream({
    push: (x: ZSet<T>) => {
      if (!view) return initial;
      return SyncPromise.one(view).then((view) => distinct(add(view, x)));
    },
    pull: () => {
      if (!view) pullView();
      if (view instanceof Promise) return initial;
      return view;
    },
    flush: () => SyncPromise.one(view ?? pullView()).then(() => void 0),
  })(downstream);
}
