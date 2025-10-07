import { add, copy, cut, type ZSet } from "../datastructure/zset";
import type { ZStream, OfZStream, PullOptions } from "./stream";
import { stream, SyncPromise, type Stream } from "../stream";
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
  limit: Stream<readonly [limit: number, offset: number]>,
) {
  let bounds: [T?, T?] = [];
  let size = 0;

  return stream({
    push(set?: ZSet<T>, nextLimit?: readonly [number, number]) {
      if (set && bounds && !nextLimit) {
        const [data, meta, shape] = set;
        const [first, last] = bounds;

        let startOffset = 0;
        let endOffset = 0;
        let overlap = 0;

        data.forEach((x, i) => {
          const value = Math.sign(meta[i]);
          if (compare(x, first, shape) < 0) {
            startOffset += value;
            endOffset += value;
          } else if (compare(x, last, shape) <= 0) {
            endOffset += value;
          } else if (endOffset < 0 && value < 0) {
            overlap++;
          }
        });

        let inWindowStart = data.findIndex(
          (x) => compare(x, first, shape) >= 0,
        );
        const beforeSet = cut(copy(set), inWindowStart);
        const rangeSet = cut(
          copy(set),
          set[0].length - inWindowStart,
          inWindowStart,
        );

        return SyncPromise.one(limit.pull()).then(([limit, offset]) => {
          const startPos = offset - Math.max(startOffset, 0);
          const endPos = offset + limit - Math.max(endOffset, 0);
          return SyncPromise.all([
            upstream.pull({
              range: [Math.abs(startOffset), startPos],
              weight: startOffset < 0 ? -1 : 1,
            }),
            upstream.pull({
              range: [Math.abs(endOffset) + overlap, endPos],
              weight: endOffset > 0 ? -1 : 1,
            }),
          ]).then(([startSet, endSet]) => {
            // TODO: maybe we also could use just a single traverse in the future
            let offsetNow = 0;
            // console.log(beforeSet, startSet, startOffset);
            traverse(
              {
                combine: (_, aMeta, bData, bMeta) => [bData, aMeta + bMeta],
                insert: (data, meta) => {
                  if (offsetNow < Math.abs(startOffset)) {
                    offsetNow += Math.abs(Math.sign(meta));
                    return;
                  }
                  return [data, meta];
                },
                update: (data, meta) => {
                  if (offsetNow < Math.abs(startOffset)) {
                    offsetNow += Math.abs(Math.sign(meta));
                    return;
                  }
                  return [data, meta];
                },
              },
              beforeSet,
              startSet,
            );
            // console.log(beforeSet);

            // console.log(rangeSet, endSet, offsetNow, endOffset);
            traverse(
              {
                combine: (_, aMeta, bData, bMeta) => [bData, aMeta + bMeta],
                insert: (data, meta) => {
                  if (offsetNow < Math.abs(endOffset)) {
                    offsetNow += Math.abs(meta);
                    return;
                  }
                  return [data, meta];
                },
                update: (data, meta) => {
                  if (offsetNow >= Math.abs(endOffset)) {
                    return;
                  }
                  offsetNow += Math.abs(meta);
                  return [data, meta];
                },
              },
              rangeSet,
              endSet,
            );
            // console.log(rangeSet);

            return add(beforeSet, rangeSet);
          });
        });
      }
    },
    pull(options?: PullOptions) {
      return SyncPromise.one(limit.pull()).then((range) => {
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
  })(upstream, limit);
}
