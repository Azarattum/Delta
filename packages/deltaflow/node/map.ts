import type { ZSet } from "../datastructure/zset";
import type { OfZStream, ZStream } from "./type";
import { stream } from "../stream";

export function map<U, TStream extends ZStream<T>, T = OfZStream<TStream>>(
  upstream: TStream,
  mapping: (x: NoInfer<T>) => U,
) {
  return stream({
    push: (x: ZSet<T>) => {
      x[0].forEach((y, i) => ((x[0] as any)[i] = mapping(y)));
      return x as unknown as ZSet<U>;
    },
  })(upstream);
}
