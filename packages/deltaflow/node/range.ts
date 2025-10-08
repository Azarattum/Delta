import type { ZStream, OfZStream, PullOptions } from "./stream";
import { stream, SyncPromise, type Stream } from "../stream";
import { add, type ZSet } from "../datastructure/zset";
import { traverse } from "../datastructure/metaset";
import { compare } from "../datastructure/shape";

export function limit(limit: number, offset = 0) {
  let current = [limit, offset] as const;
  return stream({
    push: (next) => (current = next),
    pull: () => current,
  })(null);
}

export function range<TStream extends ZStream<T>, T = OfZStream<TStream>>(
  upstream: TStream,
  range: Stream<readonly [limit: number, offset: number]>,
) {
  let bounds: [T?, T?] = [];
  let size = 0;

  return stream({
    push(set?: ZSet<T>, nextRange?: readonly [number, number]) {
      if (set && bounds && !nextRange) {
        const [data, meta, shape] = set;
        const [first, last] = bounds;

        let deltaStart = 0;
        let deltaEnd = 0;
        let overlap = 0;

        data.forEach((x, i) => {
          const value = Math.sign(meta[i]);
          if (compare(x, first, shape) < 0) {
            deltaStart += value;
            deltaEnd += value;
          } else if (compare(x, last, shape) <= 0) {
            deltaEnd += value;
          } else if (deltaEnd < 0 && value < 0) {
            overlap++;
          }
        });

        return SyncPromise.one(range.pull()).then(([limit, offset]) => {
          const offsetStart = offset - Math.max(deltaStart, 0);
          const offsetEnd = offset + limit - Math.max(deltaEnd, 0);
          return SyncPromise.all([
            upstream.pull({
              range: [Math.abs(deltaStart), offsetStart],
              weight: deltaStart < 0 ? -1 : 1,
            }),
            upstream.pull({
              range: [Math.abs(deltaEnd) + overlap, offsetEnd],
              weight: deltaEnd > 0 ? -1 : 1,
            }),
          ]).then(([extraStart, extraEnd]) => {
            let offset = 0;
            return traverse(
              {
                shallow: true,
                combine: (_, aMeta, bData, bMeta) => [bData, aMeta + bMeta],
                insert: (data, meta) => {
                  const isStart = compare(data, extraEnd[0][0], shape) < 0;
                  if (offset < Math.abs(isStart ? deltaStart : deltaEnd)) {
                    offset += Math.abs(Math.sign(meta));
                    return;
                  }
                  return [data, meta];
                },
                update: (data, meta, shape) => {
                  if (compare(data, first, shape) < 0) {
                    if (offset < Math.abs(deltaStart)) {
                      offset += Math.abs(Math.sign(meta));
                      return;
                    }
                    return [data, meta];
                  } else {
                    if (offset >= Math.abs(deltaEnd)) {
                      return;
                    }
                    offset += Math.abs(meta);
                    return [data, meta];
                  }
                },
              },
              set,
              add(extraStart, extraEnd),
            );
          });
        });
      }
    },
    pull(options?: PullOptions) {
      return SyncPromise.one(range.pull()).then((range) => {
        return SyncPromise.one(upstream.pull({ ...options, range })).then(
          (set) => {
            size = set[0].length;
            bounds[0] = set[0][0];
            bounds[1] = size >= range[0] ? set[0].at(-1) : undefined;
            return set;
          },
        );
      });
    },
    compress([sets, ranges]) {
      return [[sets?.reduce((acc, x) => add(acc, x, false)), ranges?.at(-1)]];
    },
  })(upstream, range);
}
