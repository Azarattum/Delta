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
      const [oldLimit, oldOffset] = limits ?? [0, 0];
      let [shiftLower, shiftUpper] = range ?? [0, 0];
      let [lower, upper] = bounds ?? [undefined, undefined];
      const oldWindow = oldLimit - missing;

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

      // TODO: reintroduce as optimized path
      // if (!set && limit <= 0) {
      //   missing = limit;
      //   bounds = [undefined, undefined];
      //   const cursor = { anchor: lower, count: oldWindow };
      //   return upstream.pull({ cursor, weight: -1 });
      // } else if (!lower && set && missing <= 0) {
      //   bounds = [undefined, undefined];
      //   return zero<T>();
      // }

      let [lowerRemoved, upperRemoved] = [false, false];
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
            if (shiftLower >= 0) return;
            if (meta < 0) return void removed.push(data);
            (lenLower += 1), (lenUpper += 1);
          } else if (upper && cmpUpper > 0) {
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
      let upperOffset = lower ? 0 : offset;
      const lowerExclusive = shiftLower < 0 && !!lower;
      const upperExclusive = shiftUpper > 0 && !!upper;

      const lowerWeight = -Math.sign(shiftLower);
      const upperWeight = Math.sign(shiftUpper);

      // Remove up to `missing` items (optional optimization)
      if (upperCount < 0 && !upper) {
        upperCount += Math.min(missing, -upperCount);
      }

      const needExtraLower =
        limit && (shiftLower > 0 || (shiftLower === 0 && lowerRemoved));
      if (needExtraLower) lowerCount += 1;

      const needExtraUpper =
        limit && (shiftUpper < 0 || (shiftUpper === 0 && upperRemoved));
      if (needExtraUpper) upperCount += -1;

      let availableWindow = oldWindow - removedWithin;
      if (lowerCount > 0) {
        const lowerOverlap = lowerCount - availableWindow;
        if (lowerOverlap > 0) {
          lowerCount -= lowerOverlap;
        }

        // TODO: enable optimized path (with dirty checks when set is present)
        // const lowerOvershoot = lowerCount - limit;
        // if (!set && lowerOvershoot > 0) {
        //   lowerCount -= lowerOvershoot;
        //   lowerOffset += lowerOvershoot;
        // }
      }

      if (upperCount < 0) {
        availableWindow -= Math.max(0, lowerCount);
        const upperOverlap = -upperCount - availableWindow;
        if (upperOverlap) {
          upperCount -= -upperOverlap;
        }

        // TODO: enable optimized path (with dirty checks when set is present)
        // const upperOvershoot = -upperCount - limit;
        // if (!set && upperOvershoot > 0) {
        //   upperCount -= -upperOvershoot;
        //   upperOffset += upperOvershoot;
        // }
      }

      // Prevent out of bounds pull
      if (lower && !upper && shiftUpper > 0) upperCount = 0;

      // TODO: just for dev
      if (lowerOffset < 0) throw new Error("unreachable lower");
      if (upperOffset < 0) throw new Error("unreachable upper");

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
        let pulledLenLower = len(pulledLower);
        let pulledLenUpper = len(pulledUpper);

        if (needExtraUpper && pulledLenUpper > Math.abs(shiftUpper)) {
          pulledUpper[1][0] = 0;
        }
        if (needExtraLower && pulledLenLower > Math.abs(shiftLower)) {
          pulledLower[1][pulledLenLower - 1] = 0;
        }

        // TODO: enable optimized path
        // if (!set) {
        //   // if (shiftLower > 0 || lowerRemoved) lower = extraLower;
        //   // else lower = pulledLower[0][0];
        //   // if (hasExtraUpper || upperRemoved) upper = extraUpper;
        //   // else upper = pulledUpper[0].at(-1);

        //   // state[0] += pulledLenUpper - len(pulledLower);
        //   // bounds = [lower, upper];
        //   return add(pulledLower, pulledUpper);
        // }

        const pulled = add(pulledLower, pulledUpper);

        const slots = pulledLenUpper + removedWithin + missing + shiftLower;

        let skipLower =
          lenLower +
          gap * (1 + Math.sign(offset - oldOffset)) +
          (shiftLower <= 0 ? pulledLenLower + shiftLower : 0);
        let keepLower =
          shiftLower <= 0 ?
            Math.min(Math.abs(shiftLower), limit) // Keep by new limit if growing
          : Math.abs(shiftLower); // Need exact shifts accounting for intra-window inserts

        let keepUpper = Math.abs(shiftUpper); // TODO: why not limit here?..
        let skipUpper = keepUpper - limit; // TODO: aren't we supposed to `(shiftUpper >= 0 ? limit : oldLimit)` instead?
        let slot = 0;

        let newLower: T | undefined;
        const process = (data: T, meta: number, region: number) => {
          if (region < 0) {
            if (needExtraLower && !keepLower) newLower ??= data;
            if (skipLower-- > 0) return; // Skip first for the merge
            if (keepLower-- <= 0 && shiftLower <= 0) return; // Keep to prevent overflow
            if (keepLower < 0 && slot++ < slots) return void (upper = data); // For right shifts, consume slots when exhausted
            if (shiftLower <= 0) newLower ??= data;
            if (needExtraUpper) upper = data;
          } else if (region > 0) {
            if (shiftUpper > 0 && keepUpper-- <= 0) return; // Skip last for the merge
            if (shiftUpper > 0 && skipUpper-- > 0) return; // Skip to prevent overflow
            if (meta >= 0) upper = data;
            if (shiftUpper < 0 && slot++ < slots) return void (upper = data); // Skip and occupy within slot // TODO: why not `shiftUpper <= 0`?
            if (needExtraLower || !lower) newLower ??= data;
          } else if (meta > 0) {
            if (shiftLower > 0 && keepLower-- > 0) return;
            if (shiftUpper < 0 && slot++ >= slots) return; // Occupy slot, skip if no slots left
            if (needExtraLower) newLower ??= data;
            if (needExtraUpper) upper = data;
          }
          missing -= Math.sign(meta); // Keep missing up-to-date
          return [data, meta] as [T, number];
        };

        let [i, j] = [0, 0];
        set ??= zero<T>();
        traverse(
          {
            shallow: true,
            update: (data, meta) =>
              process(data, meta, +(++j > lenLower) + +(j > lenUpper) - 1),
            insert: (data, meta) =>
              process(data, meta, +(++i > pulledLenLower) - 0.5),
            combine: (aData, aMeta, _, bMeta) => {
              skipLower--, i++, j++;
              return (
                process(aData, aMeta + bMeta, +(i > pulledLenLower) - 0.5) ??
                (j > lenLower && j <= lenUpper ? [aData, aMeta] : undefined)
              );
            },
          },
          set,
          pulled,
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
