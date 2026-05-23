import { copy, type ZSet } from "../datastructure/zset";
import { zStream, type ZStream } from "./stream";

export function fork<TStream extends ZStream>(upstream: TStream, count = 2) {
  const clone = zStream({ push: (x: ZSet<any>) => copy(x) });
  const forks = Array.from({ length: count }, () => clone(upstream));
  return forks as unknown as TStream[];
}
