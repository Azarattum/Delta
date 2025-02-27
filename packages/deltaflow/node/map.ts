import type { ZSet } from "../datastructure/zset";
import { stream, type Stream } from "../stream";

export function map<T, U>(
  upstream: Stream<ZSet<T> | Promise<ZSet<T>>>,
  mapping: (x: T) => U,
) {
  return stream({
    push: (x: ZSet<T>) => {
      x[0].forEach((y, i) => ((x[0] as any)[i] = mapping(y)));
      return x as unknown as ZSet<U>;
    },
  })(upstream);
}
