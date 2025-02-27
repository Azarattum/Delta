import { copy, type ZSet } from "../datastructure/zset";
import { stream, type Stream } from "../stream";

export function fork<S extends Stream<ZSet<any> | Promise<ZSet<any>>>>(
  downstream: S,
  count = 2,
) {
  const clone = stream({ push: (x: ZSet<unknown>) => copy(x) });
  const forks = Array.from({ length: count }).map(() => clone(downstream));
  return forks as unknown as S[];
}
