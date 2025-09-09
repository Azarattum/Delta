import { add, distinct, zero, type ZSet } from "../datastructure/zset";
import { zStream, type OfZStream, type ZStream } from "./stream";
import { SyncPromise, type MaybePromise } from "../stream";

export function sink<TStream extends ZStream<T>, T = OfZStream<TStream>>(
  upstream: TStream,
  initial = zero<T>(),
) {
  let pulling: MaybePromise<void> | undefined;
  let view: ZSet<T> | undefined;
  let queue: ZSet<T>[] = [];

  const preload = () =>
    (pulling ??= SyncPromise.one(upstream.pull()).then((data) => {
      queue.unshift(data);
      node.push(data);
      return node.flush();
    }) as MaybePromise<void>);

  const node = zStream({
    push: (x: ZSet<T>) => {
      if (view) return distinct(add(view, x));
      if (x !== queue[0]) return queue.push(x), initial;

      try {
        return (view = distinct(queue.reduce((a, b) => add(a, b))));
      } finally {
        queue = [];
      }
    },
    pull: () => {
      if (!view) preload();
      return view ?? initial;
    },
  })(upstream);

  return Object.assign(node, { preload });
}
