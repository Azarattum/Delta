import { copy, type ZSet } from "../datastructure/zset";
import { stream, type Stream } from "../stream";

export function fork<S extends Stream<ZSet<any> | Promise<ZSet<any>>>>(
  upstream: S,
  count = 2,
) {
  const clone = stream({ push: (x: ZSet<unknown>) => copy(x) });
  const forks = Array.from({ length: count }).map(() => clone(upstream));
  return forks as unknown as S[];
}
