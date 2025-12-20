import { zStream, type OfZStream, type ZStream } from "./stream";
import { transform, type ZSet } from "../datastructure/zset";

export function filter<TStream extends ZStream<T>, T = OfZStream<TStream>>(
  upstream: TStream,
  predicate: (x: NoInfer<T>) => boolean,
) {
  return zStream({
    push: (x: ZSet<T>) =>
      transform(x, (data, meta) => predicate(data) && [data, meta]),
  })(upstream);
}
