import type { ZStream, OfZStream, PullOptions } from "./stream";
import { stream, SyncPromise, type Stream } from "../stream";
import { add, transform, type ZSet } from "../datastructure/zset";
import { compare, TYPE } from "../datastructure/shape";
import { traverse } from "../datastructure/metaset";

export function range<
  TStream extends ZStream<T>,
  T extends Record<string, unknown> = OfZStream<TStream>,
>(upstream: TStream, range: Stream<readonly [limit: number, offset: number]>) {
  let bounds: [T?, T?] = [];
  let missing = 0;

  return stream({
    push(set?: ZSet<T>, [deltaStart, deltaEnd]: [number, number] = [0, 0]) {
      const [lower, upper] = bounds;
      if (!lower) return [[], [], set?.[2]]; // TODO: handle better with `missing` like upper

      let countLower = 0;
      let countWithin = 0;
      let countUpper = 0;

      let shiftLower = deltaStart;
      let shiftUpper = deltaEnd;

      let removedLower: T[] = [];
      let removedWithin: T[] = [];
      let removedUpper: T[] = [];

      if (set) {
        transform(set, (data, meta, shape) => {
          const isLower = lower && compare(data, lower, shape) < 0;
          const isUpper = !isLower && upper && compare(data, upper, shape) > 0;

          // Compute the lower bound
          if (isLower) {
            shiftLower -= Math.sign(meta);
            shiftUpper -= Math.sign(meta);
            if (shiftLower >= 0) return;
            if (meta < 0) return void removedLower.push(data);
            countLower += 1;
          } else if (isUpper) {
            if (shiftUpper <= 0) return;
            if (meta < 0) return void removedUpper.push(data);
            countUpper += 1;
          } else {
            shiftUpper -= Math.sign(meta);

            if (shiftLower >= 0 || shiftUpper <= 0) {
              if (meta < 0) removedWithin.push(data);
            }
            countWithin += 1;
          }

          return [data, meta];
        });
      }

      const keys =
        set &&
        ([
          set[2]?.keys.filter((_, i) => set![2]!.types[i] & TYPE.PRIMARY)!,
        ] as const); // TODO: handle null

      const expectedLower = shiftLower;
      const expectedUpper = // This accounts for a case where there aren't enough items to fill out window
        upper ? shiftUpper : Math.min(missing + shiftUpper, 0);

      return SyncPromise.all([
        upstream.pull({
          cursor: {
            anchor: lower,
            count: expectedLower,
            exclusive: shiftLower < 0,
          },
          filter: keys && [
            {
              keys,
              items: shiftLower < 0 ? removedLower : removedWithin,
              exclude: true,
            },
          ],
          weight: -Math.sign(shiftLower),
        }),
        upstream.pull({
          cursor: {
            anchor: upper,
            count: expectedUpper,
            exclusive: shiftUpper > 0,
          },
          filter: keys && [
            {
              keys,
              items: shiftUpper > 0 ? removedUpper : removedWithin,
              exclude: true,
            },
          ],
          weight: Math.sign(shiftUpper),
        }),
      ]).then(([pulledLower, pulledUpper]) => {
        const pulledLowerLen = pulledLower[0].length;
        const pulledUpperLen = pulledUpper[0].length;
        const pulled = add(pulledLower, pulledUpper);
        if (!set) return pulled;

        const totalLower = countLower + pulledLowerLen;
        const enterLower = Math.max(0, -shiftLower);
        const enterUpper = Math.max(0, shiftUpper);

        // Lower entering: skip first items (furthest from window), keep last enterLower
        const skipLower = enterLower > 0 ? totalLower - enterLower : 0;
        // Lower leaving: keep first min(shiftLower, shiftUpper) if both positive
        const keepLowerLeave =
          shiftLower > 0 ?
            Math.min(shiftLower, shiftUpper > 0 ? shiftUpper : shiftLower)
          : 0;

        // For lower leaving: within adds positioned before last pulled lower absorb exits
        const lastPulledLower = pulled[0][pulledLowerLen - 1];

        // Count absorbable items
        let absorbableLower = 0;
        for (let i = 0; i < set[0].length; i++) {
          if (lower && compare(set[0][i], lower, set[2]) < 0) continue;
          if (upper && compare(set[0][i], upper, set[2]) > 0) continue;
          if (set[1][i] > 0) {
            if (compare(set[0][i], lastPulledLower, set[2]) < 0)
              absorbableLower++;
          }
        }
        const absorbedLower = Math.min(absorbableLower, keepLowerLeave);
        // Effective slots for within adds = pulled items leaving + within removes - items entering from lower
        // Items entering from lower push everything right, reducing slots for upper
        const effectiveSlots =
          pulledUpperLen + removedWithin.length - enterLower;

        let posLower = 0,
          posUpper = 0;
        let pulledLowerPos = 0,
          pulledUpperPos = 0;
        let filteredLower = 0;
        let withinAddsSeen = 0;

        return traverse(
          {
            shallow: true,
            combine: (aData, aMeta, _, bMeta) => [aData, aMeta + bMeta],
            insert: (data, meta) => {
              // Pulled items: first pulledLowerLen are from lower, rest from upper
              if (pulledLowerPos < pulledLowerLen) {
                pulledLowerPos++;
                posLower++;
                if (shiftLower < 0 && posLower <= skipLower) return;
                // Lower leaving: keep first keepLowerLeave items
                if (shiftLower > 0 && pulledLowerPos > keepLowerLeave) return;
                return [data, meta];
              }
              // Upper pulled item: leave if newPosition > windowSize
              // newPosition = originalPosition + withinAddsSeen
              // originalPosition = windowSize - pulledUpperLen + pulledUpperPos
              // So leave if: pulledUpperPos + withinAddsSeen > pulledUpperLen
              pulledUpperPos++;
              posUpper++;
              if (shiftUpper > 0 && posUpper > enterUpper) return;
              if (
                upper &&
                shiftUpper < 0 &&
                pulledUpperPos + withinAddsSeen <= effectiveSlots
              )
                return;
              return [data, meta];
            },
            update: (data, meta, shape) => {
              if (lower && compare(data, lower, shape) < 0) {
                posLower++;
                if (shiftLower < 0 && posLower <= skipLower) return;
                return [data, meta];
              }
              if (upper && compare(data, upper, shape) > 0) {
                posUpper++;
                if (shiftUpper > 0 && posUpper > enterUpper) return;
                return [data, meta];
              }
              // Within: track adds and filter appropriately
              if (meta > 0) {
                withinAddsSeen++;
                // Filter adds close to lower that absorb lower exits
                if (
                  filteredLower < absorbedLower &&
                  compare(data, lastPulledLower, shape) < 0
                ) {
                  filteredLower++;
                  return;
                }
                // Filter adds that don't fit (only when there's an upper bound)
                // An add fits if position <= effectiveSlots (pulledUpperLen + withinRemoves)
                if (
                  upper &&
                  shiftUpper < 0 &&
                  pulledUpperPos + withinAddsSeen > effectiveSlots
                ) {
                  return;
                }
              }
              return [data, meta];
            },
          },
          set,
          pulled,
        );
      });
    },
    pull(options?: PullOptions) {
      return SyncPromise.one(range.pull()).then((range) => {
        return SyncPromise.one(
          upstream.pull({
            ...options,
            cursor: { offset: range[1], count: range[0] },
          }),
        ).then((set) => {
          missing = range[0] - set[0].length;
          bounds[0] = set[0][0];
          bounds[1] = missing ? undefined : set[0].at(-1);
          return set;
        });
      });
    },
    compress([sets, ranges]) {
      return [[sets?.reduce((acc, x) => add(acc, x, false)), ranges?.at(-1)]];
    },
  })(upstream, range);
}

export function limit(limit: number, offset = 0) {
  let current = [limit, offset] as const;
  return stream({
    flush: (next) => void (next.length && (current = next.at(-1)![0])),
    compress: ([updates]) => [[updates.at(-1)!]],
    pull: () => current,
    push: (next) => {
      const deltaStart = next[1] - current[1];
      const deltaEnd = next[0] + next[1] - (current[0] + current[1]);
      return [deltaStart, deltaEnd] as const;
    },
  })(null);
}
