import { reorder, compare, type Order } from "../datastructure/shape";
import { zStream, type OfZStream, type ZStream } from "./stream";
import { sort, type ZSet } from "../datastructure/zset";

export function order<TStream extends ZStream<T>, T = OfZStream<TStream>>(
  upstream: TStream,
  ...order: Order<T>
) {
  return zStream({
    push: (x: ZSet<T>) => {
      const shape = reorder(x[2], ...order);
      if (shape !== x[2]) {
        sort(x, (a, b) => compare(a, b, shape));
        x[2] = shape;
      }
      return x;
    },
    pull: (options) => {
      return upstream.pull({
        ...options,
        order: [...(options?.order ?? []), ...order],
      });
    },
  })(upstream);
}
