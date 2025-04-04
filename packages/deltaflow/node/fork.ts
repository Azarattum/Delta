import { copy, type ZSet } from "../datastructure/zset";
import type { ZStream } from "./type";
import { stream } from "../stream";

export function fork<TStream extends ZStream>(upstream: TStream, count = 2) {
  const clone = stream({ push: (x: ZSet<unknown>) => copy(x) });
  const forks = Array.from({ length: count }, () => clone(upstream));
  return forks as unknown as TStream[];
}
