import {
  cardinality,
  transform,
  distinct,
  combine,
  zero,
  add,
} from "../datastructure/zset";
import type { Follows, MaybePromise, PullOf, Stream } from "../stream";
import type { ZStream, OfZStream, ZPullOptions } from "./stream";
import { compare, primary } from "../datastructure/shape";
import { len, traverse } from "../datastructure/metaset";
import type { ZSet } from "../datastructure/zset";
import { stream, SyncPromise } from "../stream";

export function range<
  TStream extends ZStream<T>,
  T extends Record<string, unknown> = OfZStream<TStream>,
>(upstream: TStream, range: Stream<Range>) {
  let bounds: [T?, T?] | undefined;
  let [missing, quantity] = [0, 0];
  let limits: Range | undefined;

  return stream({
    push(set?: ZSet<T>, range?: Range, base?: ZSet<T>): MaybePromise<ZSet<T>> {
      if (!bounds) {
        return SyncPromise.one(this.pull()).then(() => this.push(set, range));
      }

      let [lower, upper] = bounds ?? [undefined, undefined];
      let [shiftLower, shiftUpper] = range ?? [0, 0];
      let [limit, offset] = limits ?? [0, 0];
      let untouched = limit - missing;

      const [extended, moved] = [shiftUpper - shiftLower, shiftLower];
      const gap = Math.max(0, offset - quantity);
      limits = [(limit += extended), (offset += moved)];

      if (!lower && set && limit && limit === extended) {
        return SyncPromise.one(this.pull()).then((pulled) =>
          this.push(set, undefined, pulled),
        );
      }

      // Normalize out of bounds shifts
      shiftLower -= gap * Math.sign(shiftLower);
      shiftUpper -= gap * Math.sign(shiftUpper);

      let [removedLower, removedUpper] = [!lower, !upper];
      let [dirtyLower, dirtyUpper] = [false, false];
      let [nLower, nUpper] = [0, 0];
      let removed: T[] = [];

      if (set) {
        transform(set, (data, meta, shape) => {
          const count = cardinality(meta, shape);
          const cmpLower = lower ? compare(data, lower, shape) : -1;
          const cmpUpper =
            cmpLower >= 0 && upper ? compare(data, upper, shape) : -1;

          if (cmpLower < 0) shiftLower -= count;
          if (cmpUpper <= 0) shiftUpper -= count;
          quantity += count;

          if (cmpLower < 0) {
            if (count) dirtyLower = true;
            if (shiftLower >= 0) return;
            if (count < 0) return void removed.push(data);
            (nLower += 1), (nUpper += 1);
          } else if (upper && cmpUpper > 0) {
            if (count) dirtyUpper = true;
            if (shiftUpper <= 0) return;
            if (count < 0) return void removed.push(data);
          } else {
            if (cmpLower === 0 && count < 0) removedLower = true;
            if (cmpUpper === 0 && count < 0) removedUpper = true;
            if (count < 0) removed.push(data), untouched--;
            nUpper += 1;
          }

          return [data, meta];
        });
      }

      const cursorLower = {
        anchor: lower,
        offset: 0,
        count: shiftLower,
        exclusive: shiftLower < 0 && !!lower,
      };
      const cursorUpper = {
        anchor: upper,
        offset: lower ? 0 : offset - moved,
        count: -shiftUpper - Math.min(missing, Math.max(0, -shiftUpper)),
        exclusive: shiftUpper > 0 && !!upper,
      };
      const signLower = -Math.sign(shiftLower);
      const signUpper = Math.sign(shiftUpper);

      normalizeCursor(cursorLower, dirtyLower);
      normalizeCursor(cursorUpper, dirtyUpper);
      cursorUpper.count *= -1; // Upper cursor pulls in the opposite direction

      const extraUpper =
        !!limit && (shiftUpper < 0 || (shiftUpper === 0 && removedUpper));
      const extraLower =
        !!limit && (shiftLower > 0 || (shiftLower === 0 && removedLower));

      if (extraUpper && untouched > 0) {
        cursorUpper.count -= 1;
        untouched += signUpper;
      }
      if (extraLower && untouched > +(extraUpper && !signUpper)) {
        cursorLower.count += 1;
        untouched += signLower;
      }

      // Prevent out of bounds pull
      if (lower && !upper && shiftUpper > 0) cursorUpper.count = 0;

      const keys = set && ([primary(set[2])] as const);
      const filter = keys && [{ keys, items: removed, exclude: true }];
      const optsLower = { cursor: cursorLower, filter, cardinality: signLower };
      const optsUpper = { cursor: cursorUpper, filter, cardinality: signUpper };

      return SyncPromise.all([
        cursorLower.count ? upstream.pull(optsLower) : zero<T>(),
        cursorUpper.count ? upstream.pull(optsUpper) : zero<T>(),
      ]).then(([pulledLower, pulledUpper]) => {
        const shape = set?.[2] ?? pulledLower[2] ?? pulledUpper[2];
        const pulledLenLower = len(pulledLower);
        const effectiveGap = gap * (1 + Math.sign(moved));
        const growLower = shiftLower < 0 ? pulledLenLower + shiftLower : 0;

        let skip = nLower + effectiveGap + growLower;
        let keep = Math.max(shiftLower, Math.min(-shiftLower, limit));
        let slots = limit - untouched + Math.min(shiftLower, 0);
        let grow = cursorUpper.count;

        let newLower: T | undefined;
        const process = (data: T, meta: number, region: number) => {
          const sign = Math.sign(cardinality(meta, shape));
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
          } else if (sign > 0) {
            if (shiftLower > 0 && keep-- > 0) return;
            if (shiftUpper < 0 && slots-- <= 0) return;
            if (extraLower) newLower ??= data;
            if (extraUpper) upper = data;
          }
          missing -= sign;
          return [data, meta] as [T, number];
        };

        let [i, j] = [0, 0];
        set = traverse(
          {
            shallow: true,
            update(data, meta) {
              if (!set) return (this.insert as any)(data, meta);
              return process(data, meta, +(++j > nLower) + +(j > nUpper) - 1);
            },
            insert: (data, meta) =>
              process(data, meta, +(++i > pulledLenLower) - 0.5),
            combine: (aData, aMeta, _, bMeta) => {
              skip--, i++, j++;
              const meta = combine(aMeta, bMeta, shape);
              return (
                process(aData, meta, +(i > pulledLenLower) - 0.5) ??
                (j > nLower && j <= nUpper ? [aData, aMeta] : undefined)
              );
            },
          },
          set ?? pulledLower,
          set ? add(pulledLower, pulledUpper) : pulledUpper,
        );

        missing += extended;
        if (missing > 0 || limit <= 0) upper = undefined;
        if (missing >= limit) lower = undefined;
        bounds = [newLower ?? lower, upper];

        return base ? distinct(add(base, set)) : set;
      });

      function normalizeCursor(cursor: typeof cursorLower, dirty: boolean) {
        const move = cursor.count - limit;
        if (cursor.count > 0) {
          cursor.count -= Math.max(0, cursor.count - untouched);
          untouched -= cursor.count;
        } else if (!dirty && move > 0) {
          cursor.count -= move;
          cursor.offset += move;
        }
      }
    },
    pull(options?: ZPullOptions) {
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
      ) as Follows<[PullOf<TStream>, PullOf<typeof range>], ZSet<T>>;
    },
    compress([sets, ranges]) {
      const opts = { identity: "relations" as const };
      return [[sets?.reduce((acc, x) => add(acc, x, opts)), ranges?.at(-1)]];
    },
    extensions: {
      get bounds() {
        return { lower: bounds?.[0], upper: bounds?.[1] };
      },
    },
  })(upstream, range, null);
}

export function limit(limit: number, offset = 0) {
  let current = [limit, offset] as [number, number];
  return stream({
    compress: ([updates]) => [[updates.at(-1)!]],
    pull: () => current,
    push: (next) => {
      const deltaStart = next[1] - current[1];
      const deltaEnd = next[0] + next[1] - (current[0] + current[1]);
      return [deltaStart, deltaEnd] as const;
    },
    flush: (next) => {
      next.forEach(([deltaStart, deltaEnd]) => {
        current[0] += deltaEnd - deltaStart;
        current[1] += deltaStart;
      });
    },
  })(null);
}

export type Range = readonly [limit: number, offset: number];
