import { stream, SyncPromise, type MaybePromise, type Stream } from "../stream";
import { add, distinct, len, transform, zero } from "../datastructure/zset";
import type { ZStream, OfZStream, PullOptions } from "./stream";
import { compare, primary } from "../datastructure/shape";
import { traverse } from "../datastructure/metaset";
import type { ZSet } from "../datastructure/zset";

export function range<
  TStream extends ZStream<T>,
  T extends Record<string, unknown> = OfZStream<TStream>,
>(upstream: TStream, range: Stream<Range>) {
  let bounds: [T?, T?] | undefined;
  let [missing, quantity] = [0, 0];
  let limits: Range | undefined;

  // TODO: remove `tmp` property definition
  const tmp = stream({
    push(set?: ZSet<T>, range?: Range, base?: ZSet<T>): MaybePromise<ZSet<T>> {
      // TODO: refactor usage of these values
      const oldMissing = missing;
      const [oldLimit, oldOffset] = limits ?? [0, 0];
      let [shiftLower, shiftUpper] = range ?? [0, 0];
      let [lower, upper] = bounds ?? [undefined, undefined];

      limits = [oldLimit + shiftUpper - shiftLower, oldOffset + shiftLower];
      missing += shiftUpper - shiftLower;
      const [limit, offset] = limits;

      // TODO: check if this approach covers uninitialized range
      if (!lower && set && !oldLimit && limit) {
        return SyncPromise.one(this.pull!()).then((pulled) =>
          this.push!(set, undefined, pulled),
        );
      }

      // Normalize out of bounds shifts
      const gap = Math.max(0, oldOffset - quantity);
      shiftLower -= gap * Math.sign(shiftLower);
      shiftUpper -= gap * Math.sign(shiftUpper);

      let [lowerRemoved, upperRemoved] = [!lower, !upper];
      let [dirtyLower, dirtyUpper] = [false, false];
      let [lenLower, lenUpper] = [0, 0];
      let removed: T[] = [];
      let removedWithin = 0;

      if (set) {
        transform(set, (data, meta, shape) => {
          const cmpLower = lower ? compare(data, lower, shape) : -1;
          const cmpUpper = upper ? compare(data, upper, shape) : -1;

          if (cmpLower < 0) shiftLower -= Math.sign(meta);
          if (cmpUpper <= 0) shiftUpper -= Math.sign(meta);
          quantity += Math.sign(meta);

          if (cmpLower < 0) {
            if (meta) dirtyLower = true;
            if (shiftLower >= 0) return;
            if (meta < 0) return void removed.push(data);
            (lenLower += 1), (lenUpper += 1);
          } else if (upper && cmpUpper > 0) {
            if (meta) dirtyUpper = true;
            if (shiftUpper <= 0) return;
            if (meta < 0) return void removed.push(data);
          } else {
            if (cmpLower === 0 && meta < 0) lowerRemoved = true;
            if (cmpUpper === 0 && meta < 0) upperRemoved = true;
            if (meta < 0) removed.push(data), removedWithin++;
            lenUpper += 1;
          }

          return [data, meta];
        });
      }

      const keys = set && ([primary(set[2])] as const);
      const filter = keys && [{ keys, items: removed, exclude: true }];

      let lowerCount = shiftLower;
      let lowerOffset = 0;
      let upperCount = shiftUpper;
      let upperOffset = lower ? 0 : oldOffset;
      const lowerExclusive = shiftLower < 0 && !!lower;
      const upperExclusive = shiftUpper > 0 && !!upper;
      const lowerWeight = -Math.sign(shiftLower);
      const upperWeight = Math.sign(shiftUpper);
      const [moveLower, moveUpper] = [-lowerCount - limit, upperCount - limit];

      // Remove up to `missing` items (optional optimization)
      if (upperCount < 0) {
        upperCount += Math.min(oldMissing, -upperCount);
      }

      let untouched = oldLimit - oldMissing - removedWithin;
      if (lowerCount > 0) {
        lowerCount -= Math.max(0, lowerCount - untouched);
        untouched -= lowerCount;
      } else if (!dirtyLower && moveLower > 0) {
        lowerCount -= -moveLower;
        lowerOffset += moveLower;
      }

      if (upperCount < 0) {
        upperCount -= -Math.max(0, -upperCount - untouched);
        untouched -= -upperCount;
      } else if (!dirtyUpper && moveUpper > 0) {
        upperCount -= moveUpper;
        upperOffset += moveUpper;
      }

      const extraUpper =
        limit && (shiftUpper < 0 || (shiftUpper === 0 && upperRemoved));
      const extraLower =
        limit && (shiftLower > 0 || (shiftLower === 0 && lowerRemoved));

      if (extraUpper && untouched > 0) upperCount--, (untouched += upperWeight);
      const canPullExtra = untouched > +(extraUpper && !upperWeight);
      if (extraLower && canPullExtra) lowerCount++, (untouched += lowerWeight);

      // Prevent out of bounds pull
      if (lower && !upper && shiftUpper > 0) upperCount = 0;

      return SyncPromise.all([
        upstream.pull({
          cursor: {
            anchor: lower,
            offset: lowerOffset,
            count: lowerCount,
            exclusive: lowerExclusive,
          },
          filter,
          weight: lowerWeight,
        }),
        upstream.pull({
          cursor: {
            anchor: upper,
            offset: upperOffset,
            count: upperCount,
            exclusive: upperExclusive,
          },
          filter,
          weight: upperWeight,
        }),
      ]).then(([pulledLower, pulledUpper]) => {
        const pulledLenLower = len(pulledLower);

        const growLower = shiftLower < 0 ? pulledLenLower + shiftLower : 0;
        const effectiveGap = gap * (1 + Math.sign(offset - oldOffset));

        let skip = lenLower + effectiveGap + growLower;
        let keep = Math.max(shiftLower, Math.min(-shiftLower, limit));
        let slots = limit - untouched + Math.min(shiftLower, 0);
        let grow = upperCount;

        let newLower: T | undefined;
        const process = (data: T, meta: number, region: number) => {
          if (region < 0) {
            if (skip-- > 0) return;
            if (keep > 0 ? shiftLower < 0 : extraLower) newLower ??= data;
            if (extraUpper && (slots > 0 || keep > 0)) upper = data;
            if (keep-- <= 0 && (shiftLower <= 0 || slots-- > 0)) return;
          } else if (region > 0) {
            if (shiftUpper > 0 && (grow <= 0 || grow-- > limit)) return;
            if (extraLower) newLower ??= data;
            if (shiftUpper >= 0 || slots > 0) upper = data;
            if (!shiftUpper || (shiftUpper < 0 && slots-- > 0)) return;
          } else if (meta > 0) {
            if (shiftLower > 0 && keep-- > 0) return;
            if (shiftUpper < 0 && slots-- <= 0) return;
            if (extraLower) newLower ??= data;
            if (extraUpper) upper = data;
          }
          missing -= Math.sign(meta);
          return [data, meta] as [T, number];
        };

        let [i, j] = [0, 0];
        set = traverse(
          {
            shallow: true,
            update: (data, meta) =>
              process(data, meta, +(++j > lenLower) + +(j > lenUpper) - 1),
            insert: (data, meta) =>
              process(data, meta, +(++i > pulledLenLower) - 0.5),
            combine: (aData, aMeta, _, bMeta) => {
              skip--, i++, j++;
              return (
                process(aData, aMeta + bMeta, +(i > pulledLenLower) - 0.5) ??
                (j > lenLower && j <= lenUpper ? [aData, aMeta] : undefined)
              );
            },
          },
          set ?? zero<T>(),
          add(pulledLower, pulledUpper),
        );

        if (missing > 0 || limit <= 0) upper = undefined;
        if (missing >= limit) lower = undefined;
        bounds = [newLower ?? lower, upper];

        return base ? distinct(add(base, set)) : set;
      });
    },
    pull(options?: PullOptions) {
      const total = { out: 0 };
      return SyncPromise.one(limits ?? range.pull()).then(([count, offset]) =>
        SyncPromise.one(
          upstream.pull({ ...options, total, cursor: { offset, count } }),
        ).then((set) => {
          quantity = total.out;
          limits = [count, offset];
          missing = count - len(set);
          bounds = [set[0][0], set[0][count - 1]];
          return set;
        }),
      );
    },
    compress([sets, ranges]) {
      return [[sets?.reduce((acc, x) => add(acc, x, false)), ranges?.at(-1)]];
    },
  })(upstream, range, null);

  return Object.defineProperty(tmp, "bounds", { get: () => bounds });
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

export type Range = readonly [limit: number, offset: number];
