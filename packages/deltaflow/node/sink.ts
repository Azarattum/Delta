import { add, distinct, integrate, zero } from "../datastructure/zset";
import { zStream, type OfZStream, type ZStream } from "./stream";
import { SyncPromise } from "../stream";
import type { PullOf } from "../stream";
import type { ZSet } from "../datastructure/zset";

export function sink<TStream extends ZStream<T>, T = OfZStream<TStream>>(
  upstream: TStream,
  initial = zero<T>(),
) {
  let view: ZSet<T> | ReturnType<typeof load> | undefined;
  let queue: ZSet<T>[] = [];

  function apply(base?: ZSet<T>): ZSet<T> {
    try {
      if (base) view = queue.reduce((view, x) => integrate(view, x), base);
      else view = distinct(queue.reduce((a, b) => add(a, b)));
      return view;
    } finally {
      queue = [];
    }
  }

  function load() {
    node.eager();
    return SyncPromise.one(upstream.pull() as PullOf<TStream>).then((data) => {
      queue.unshift(data);
      return apply();
    });
  }

  const node = zStream({
    pull: (): ZSet<T> =>
      (view ??= load()) instanceof Promise ? initial : view,
    flush(changes, output) {
      output.preventDefault();
      queue.push(...changes);
      if (!view) return;

      return () => SyncPromise.one(view).then((x) => output.emit(apply(x)));
    },
    extensions: { preload: () => (view ??= load()) },
  })(upstream);

  return node;
}
