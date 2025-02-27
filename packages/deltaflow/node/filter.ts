import type { ZSet } from "../datastructure/zset";
import { stream, type Stream } from "../stream";

export function filter<T>(
  downstream: Stream<ZSet<T> | Promise<ZSet<T>>>,
  predicate: (x: T) => boolean,
) {
  return stream({
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
  })(downstream);
}
