import { add, distinct, integrate, zero } from "../datastructure/zset";
import { zStream, type OfZStream, type ZStream } from "./stream";
import { SyncPromise, type MaybePromise } from "../stream";
import type { ZSet } from "../datastructure/zset";

export function sink<TStream extends ZStream<T>, T = OfZStream<TStream>>(
  upstream: TStream,
  initial = zero<T>(),
) {
  let loading: MaybePromise<void> | undefined;
  let view: ZSet<T> | undefined;
  let queue: ZSet<T>[] = [];

  const node = zStream({
    push: (x: ZSet<T>) => {
      if (view) return integrate(view, x);
      if (x !== queue[0]) return queue.push(x), initial;

      try {
        return (view = distinct(queue.reduce((a, b) => add(a, b))));
      } finally {
        queue = [];
      }
    },
    pull() {
      if (!view) node.preload();
      return view ?? initial;
    },
    extensions: {
      preload() {
        if (loading) return loading;
        node.connect();
        return (loading = SyncPromise.one(upstream.pull()).then((data) => {
          queue.unshift(data);
          this.push(data);
          return this.flush();
        }) as MaybePromise<void>);
      },
    },
  })(upstream);

  return node;
}
