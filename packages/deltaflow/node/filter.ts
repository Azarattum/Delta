import { zStream, type OfZStream, type ZStream } from "./stream";
import { type ZSet } from "../datastructure/zset";

export function filter<TStream extends ZStream<T>, T = OfZStream<TStream>>(
  upstream: TStream,
  predicate: (x: NoInfer<T>) => boolean,
) {
  return zStream({
    push: (x: ZSet<T>) => {
      let index = 0;
      x[0].forEach((y, i) => {
        if (predicate(y)) {
          x[0][index] = y;
          x[1][index++] = x[1][i];
        }
      });
      x[0].length = index;
      x[1].length = index;
      return x;
    },
  })(upstream);
}
