import { zStream, type OfZStream, type ZStream } from "./stream";
import { transform, type ZSet } from "../datastructure/zset";

export function map<U, TStream extends ZStream<T>, T = OfZStream<TStream>>(
  upstream: TStream,
  mapping: (x: NoInfer<T>) => U,
) {
  return zStream({
    push: (x: ZSet<T>) => transform(x, (data, meta) => [mapping(data), meta]),
  })(upstream);
}
