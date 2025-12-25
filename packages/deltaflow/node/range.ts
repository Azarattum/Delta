import type { ZStream, OfZStream, PullOptions } from "./stream";
import { stream, SyncPromise, type Stream } from "../stream";
import { add, cut, transform, type ZSet } from "../datastructure/zset";
import { compare, TYPE } from "../datastructure/shape";

export function range<
  TStream extends ZStream<T>,
  T extends Record<string, unknown> = OfZStream<TStream>,
>(upstream: TStream, range: Stream<readonly [limit: number, offset: number]>) {
  let bounds: [T?, T?] = [];
  let missing = 0;

  return stream({
    push(set?: ZSet<T>, [deltaStart, deltaEnd]: [number, number] = [0, 0]) {
      // console.log([1, 2, "[", 3, 4, 5, 6]);
      // console.log(set?.[0].map((x, i) => (x as any).id * (set?.[1][i] ?? NaN)));

      // if (bounds.length && set) {
      const [lower, upper] = bounds;
      if (!lower) return [[], [], set?.[2]]; // TODO: handle better with `missing` like upper

      let countLower = 0;
      let countUpper = 0;

      let shiftLower = deltaStart;
      let shiftUpper = deltaEnd;

      let excessiveLower = 0;
      let skipLower: T[] = [];
      let removedLower: T[] = [];

      let excessiveUpper = 0;
      let skipUpper: T[] = [];
      let removedUpper: T[] = [];

      set &&
        transform(set, (data, meta, shape) => {
          const cmpLower = lower ? compare(data, lower, shape) : 1;
          const cmpUpper = upper ? compare(data, upper, shape) : -1;

          // Compute the lower bound
          if (cmpLower < 0) {
            shiftLower -= Math.sign(meta);
            shiftUpper -= Math.sign(meta); // TODO: refactor
            countLower += 1;

            if (meta > 0) {
              // skipLower.length <= -shiftLower TODO: is this correct? how to not overpush?
              if (shiftLower < 0) skipLower.push(data);
              else return void (countLower -= 1);
              // TODO: since shift is dynamic, could there be a situation where we remove something eligible for skip?
            } else {
              if (shiftLower < 0) removedLower.push(data);
              return void ((countLower -= 1), (excessiveLower += 1));
            }
          } else {
            if (shiftLower > 0 && meta < 0) removedLower.push(data);
          }

          // Compute the upper bound
          if (cmpUpper > 0) {
            countUpper += 1;
            if (meta > 0) {
              if (shiftUpper > 0 && skipUpper.length < shiftUpper) {
                skipUpper.push(data);
              } else return void (countUpper -= 1);
            } else {
              if (shiftUpper > 0) removedUpper.push(data);
              return void (countUpper -= 1);
            }
          } else {
            if (shiftUpper < 0 && meta > 0 && cmpLower > 0) {
              skipUpper.push(data); // TODO: sure? is this optimal?
            }
            if (cmpLower >= 0) {
              // TODO: refactor
              shiftUpper -= Math.sign(meta);
            }
          }

          return [data, meta];
        });

      // TODO: for anchor update
      // if (shift >= 0) {
      // shift += 1;
      // }

      const keys =
        set &&
        ([
          set[2]?.keys.filter((_, i) => set![2]!.types[i] & TYPE.PRIMARY)!,
        ] as const); // TODO: handle null

      const expectedUpper =
        upper ? shiftUpper : Math.min(missing + shiftUpper, 0);

      return SyncPromise.all([
        upstream.pull({
          cursor: {
            anchor: lower,
            skip: skipLower,
            count: shiftLower,
            exclusive: shiftLower < 0,
          },
          filter: keys && [{ keys, items: removedLower, exclude: true }],
          weight: -Math.sign(shiftLower),
        }),
        upstream.pull({
          cursor: {
            anchor: upper,
            skip: skipUpper,
            count: expectedUpper,
            exclusive: shiftUpper > 0,
          },
          filter: keys && [{ keys, items: removedUpper, exclude: true }],
          weight: Math.sign(shiftUpper),
        }),
      ]).then(([pulledLower, pulledUpper]) => {
        // console.log(cursor);
        // console.log(
        //   "upper:",
        //   pulledUpper[0].map((n, i) => n.id * Math.sign(pulledUpper[1][i])),
        // );
        // if (!set) throw new Error("TODO: don't care for now");

        // console.log(
        //   set[0]?.map((x) => (x as any).id),
        //   lowerCount,
        //   upperCount,
        // );

        // console.log(
        //   `upper (${shiftUpper}):`,
        //   pulledUpper[0].map(
        //     (x, i) => (pulledUpper[1][i] < 0 ? "-" : "") + (x as any).name,
        //   ),
        //   // shiftUpper,
        //   // upper ? shiftUpper : Math.min(missing + shiftUpper, 0),
        //   // skipUpper,
        //   // shiftUpper,
        // );

        if (!set) return add(pulledLower, pulledUpper);

        excessiveLower += pulledLower[0].length;
        excessiveLower = Math.min(excessiveLower, countLower);

        if (shiftUpper < 0) {
          excessiveUpper += Math.abs(expectedUpper) - pulledUpper[0].length;
          excessiveUpper = Math.min(excessiveUpper, set[0].length - countLower);
        } else {
          excessiveUpper += pulledUpper[0].length;
          excessiveUpper = Math.min(excessiveUpper, countUpper);
        }
        // countUpper = shiftUpper > 0 ? countUpper : set[0].length - countLower;
        // excessiveUpper += Math.abs(expectedUpper) - pulledUpper[0].length;
        // console.log(expectedUpper);
        // console.log(excessiveUpper, countUpper);
        // excessiveUpper = Math.min(excessiveUpper, countUpper);

        if (excessiveUpper || excessiveLower) {
          set = cut(set, excessiveLower, -excessiveUpper || set[0].length)[1];
        }

        const pulled = add(pulledLower, pulledUpper);
        const final = add(pulled, set);
        // console.table(final[0]);
        // console.log(final);
        return final;
        // return add(pulledUpper, set);
      });
      // }

      // console.log(set, deltaStart);
      // throw new Error("Range stream push without bounds is not implemented");
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
