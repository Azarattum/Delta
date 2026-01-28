import type { ZStream, OfZStream, PullOptions } from "./stream";
import { stream, SyncPromise, type Stream } from "../stream";
import { add, cut, len, transform, type ZSet } from "../datastructure/zset";
import { compare, primary } from "../datastructure/shape";
import { traverse } from "../datastructure/metaset";

export function range<
  TStream extends ZStream<T>,
  T extends Record<string, unknown> = OfZStream<TStream>,
>(upstream: TStream, range: Stream<readonly [limit: number, offset: number]>) {
  let bounds: [T?, T?] = [];
  let missing = 0;

  return stream({
    push(set?: ZSet<T>, [deltaStart, deltaEnd]: [number, number] = [0, 0]) {
      let [lower, upper] = bounds;

      if (!lower) {
        if (!set && deltaEnd <= 0) return [[], [], undefined];

        if (deltaEnd > 0) {
          const count = missing + deltaEnd;
          return SyncPromise.one(
            upstream.pull({ cursor: { offset: 0, count } }), // TODO: not necessarily 0
          ).then((pulled) => {
            const len = pulled[0].length;
            missing = count - len;
            bounds =
              len ? [pulled[0][0], missing ? undefined : pulled[0].at(-1)] : [];
            return pulled;
          });
        }

        cut(set!, missing);
        const length = len(set!);
        if (!length) return [[], [], set![2]];
        missing -= set![0].length;
        bounds = [set![0][0], missing ? undefined : set![0].at(-1)];
        return set!;
      }

      let lenLower = 0;
      let lenUpper = 0;
      let shiftLower = deltaStart;
      let shiftUpper = deltaEnd;

      let removed: T[] = [];
      let lowerRemoved = false;
      let upperRemoved = false;

      if (set) {
        transform(set, (data, meta, shape) => {
          const cmpLower = compare(data, lower, shape);
          const cmpUpper = upper ? compare(data, upper, shape) : -1;

          if (cmpLower <= 0) shiftLower -= Math.sign(meta);
          if (cmpUpper <= 0) shiftUpper -= Math.sign(meta);

          if (cmpLower < 0) {
            if (shiftLower >= 0) return;
            if (meta < 0) return void removed.push(data);
            (lenLower += 1), (lenUpper += 1);
          } else if (cmpUpper > 0) {
            if (shiftUpper <= 0) return;
            if (meta < 0) return void removed.push(data);
          } else {
            if (cmpLower === 0 && meta < 0) lowerRemoved = true;
            else if (cmpUpper === 0 && meta < 0) upperRemoved = true;
            else if (meta < 0) removed.push(data);
            lenUpper += 1;
          }

          return [data, meta];
        });
      }

      const shrinkUpper = shiftUpper < 0 && upper;
      const keys = set && ([primary(set[2])] as const);
      const needExtraLower = shiftLower > 0; // TODO: this is weird, why no removed check here?
      const needExtraUpper = shrinkUpper || (upperRemoved && shiftUpper <= 0);

      return SyncPromise.all([
        upstream.pull({
          cursor: {
            anchor: lower,
            count: shiftLower + +needExtraLower - +lowerRemoved,
            exclusive: shiftLower < 0 || lowerRemoved,
          },
          filter: keys && [{ keys, items: removed, exclude: true }],
          weight: -Math.sign(shiftLower),
        }),
        upstream.pull({
          cursor: {
            anchor: upper,
            count:
              (upper ? shiftUpper : Math.min(missing + shiftUpper, 0)) -
              (needExtraUpper ? 1 : 0),
            exclusive: shiftUpper > 0 || upperRemoved,
          },
          filter: keys && [{ keys, items: removed, exclude: true }],
          weight: Math.sign(shiftUpper),
        }),
      ]).then(([pulledLower, pulledUpper]) => {
        const hasExtraLower =
          needExtraLower && len(pulledLower) > shiftLower - +lowerRemoved;
        const hasExtraUpper = needExtraUpper && len(pulledUpper) > -shiftUpper;

        const extraLower = pulledLower[0].at(-1);
        const extraUpper = pulledUpper[0].at(0);

        if (hasExtraLower) cut(pulledLower, -1);
        if (hasExtraUpper) pulledUpper = cut(pulledUpper, 1)[1];

        const pulledLenLower = pulledLower[0].length;
        const pulledLenUpper = pulledUpper[0].length;
        const pulled = add(pulledLower, pulledUpper);

        if (shiftLower > 0 || lowerRemoved) lower = extraLower;
        if (shiftUpper < 0 || upperRemoved) upper = extraUpper;

        if (!set) {
          if (shiftLower < 0 && pulledLenLower) lower = pulledLower[0].at(-1);
          if (shiftUpper > 0 && pulledLenUpper) upper = pulledUpper[0].at(-1);
          missing += shiftUpper - pulledLenUpper;
          bounds = [lower, upper];
          return pulled;
        }
        if (shiftLower < 0) lower = undefined;
        if (shiftUpper > 0) upper = undefined;

        const enterLower = Math.max(0, -shiftLower);
        const slots =
          pulledLenUpper + removed.length + +upperRemoved - enterLower;

        let keepLower =
          shiftUpper > 0 ? Math.min(shiftLower, shiftUpper) : shiftLower;
        let skipLower = lenLower + pulledLenLower - enterLower;
        let slotWithin = 0;
        let keepUpper = shiftUpper;

        let lowerSetOnce = false;
        const setLower = (x: T) =>
          lowerSetOnce || ((lowerSetOnce = true), (lower = x));

        const process = (data: T, meta: number, region: number) => {
          if (region < 0) {
            if (shiftLower < 0 && skipLower-- > 0) return;
            if (shiftLower < 0 || i > keepLower) setLower(data);
            if (shiftLower > 0 && i > keepLower) return;
            if (shrinkUpper && compare(data, upper, set![2]) > 0) upper = data;
          } else if (region > 0) {
            if (shiftUpper > 0 && keepUpper-- <= 0) return;
            if (shiftUpper > 0 || ++slotWithin <= slots) upper = data;
            if (shrinkUpper && slotWithin <= slots) return;
          } else if (meta > 0) {
            if (shiftLower > 0 && i < pulledLenLower) return void keepLower--;
            if (shiftLower > 0) setLower(data);
            if (shrinkUpper && ++slotWithin > slots) return;
            if (shrinkUpper && compare(data, upper, set![2]) > 0) upper = data;
            else if (missing > 0 && missing <= -shiftUpper) upper = data;
          }
          return [data, meta] as [T, number];
        };

        let [i, j] = [0, 0];
        traverse(
          {
            shallow: true,
            combine: (aData, aMeta, _, bMeta) => (j++, [aData, aMeta + bMeta]),
            update: (data, meta) =>
              process(data, meta, +(++j > lenLower) + +(j > lenUpper) - 1),
            insert: (data, meta) =>
              process(data, meta, i++ < pulledLenLower ? -1 : 1),
          },
          set,
          pulled,
        );

        if (missing > 0 && shiftUpper < 0) missing += shiftUpper;
        bounds = [lower, upper];
        return set;
      });
    },
    pull(options?: PullOptions) {
      return SyncPromise.one(range.pull()).then(([limit, offset]) =>
        SyncPromise.one(
          upstream.pull({ ...options, cursor: { offset, count: limit } }),
        ).then((set) => {
          missing = limit - set[0].length;
          bounds = [set[0][0], missing ? undefined : set[0].at(-1)];
          return set;
        }),
      );
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
