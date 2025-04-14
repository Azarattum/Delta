import { compare, sort, type ZSet } from "../datastructure/zset";
import type { OfZStream, ZStream } from "./type";
import { reorder } from "../datastructure/shape";
import { stream } from "../stream";

export function order<TStream extends ZStream<T>, T = OfZStream<TStream>>(
  upstream: TStream,
  ...ordering: (NoInfer<keyof T> | [NoInfer<keyof T>, ("asc" | "desc")?])[]
) {
  return stream({
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
