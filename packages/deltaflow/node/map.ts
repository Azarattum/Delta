import { zStream, type OfZStream, type ZStream } from "./stream";
import type { ZSet } from "../datastructure/zset";

export function map<U, TStream extends ZStream<T>, T = OfZStream<TStream>>(
  upstream: TStream,
  mapping: (x: NoInfer<T>) => U,
) {
  return zStream({
    push: (x: ZSet<T>) => {
      x[0].forEach((y, i) => ((x[0] as any)[i] = mapping(y)));
      return x as unknown as ZSet<U>;
    },
  })(upstream);
}
