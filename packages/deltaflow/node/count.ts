import type { ZStream, OfZStream, PullOptions } from "./stream";
import type { IsAsyncStream, MaybePromise } from "../stream";
import type { ZSet } from "../datastructure/zset";
import { stream, SyncPromise } from "../stream";

export function count<
  TStream extends ZStream<T>,
  T extends Record<string, unknown> = OfZStream<TStream>,
>(upstream: TStream) {
  type TReturn = IsAsyncStream<TStream, MaybePromise<number>, number>;
  let total: number | undefined;

  return stream({
    push(set: ZSet<T>): MaybePromise<number> {
      if (total == null) {
        return SyncPromise.one(this.pull()).then(() => this.push(set));
      }

      return (total = set[1].reduce((acc, x) => acc + Math.sign(x), total));
    },
    pull(options?: PullOptions) {
      if (total != null) return total as TReturn;
      const box = { out: 0 };
      return SyncPromise.one(upstream.pull({ ...options, total: box })).then(
        () => (total = box.out),
      ) as TReturn;
    },
  })(upstream);
}
