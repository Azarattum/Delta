import { zStream, type OfZStream, type ZStream } from "./stream";
import { reorder, compare } from "../datastructure/shape";
import { sort, type ZSet } from "../datastructure/zset";

export function order<TStream extends ZStream<T>, T = OfZStream<TStream>>(
  upstream: TStream,
  ...ordering: (NoInfer<keyof T> | [NoInfer<keyof T>, ("asc" | "desc")?])[]
) {
  return zStream({
    push: (x: ZSet<T>) => {
      const shape = reorder(x[2], ...ordering);
      if (shape !== x[2]) {
        sort(x, (a, b) => compare(a, b, shape));
        x[2] = shape;
      }
      return x;
    },
    pull: (options) => {
      return upstream.pull({
        ...options,
        ordering: [...(options?.ordering ?? []), ...ordering],
      });
    },
  })(upstream);
}
