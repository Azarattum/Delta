import { add, copy, multiply, sort, zero } from "../datastructure/zset";
import type { ZSet } from "../datastructure/zset";
import type { OfZStream, ZStream } from "./type";
import { stream, SyncPromise } from "../stream";

export function join<
  const AStream extends ZStream<A>,
  const BStream extends ZStream<B>,
  const K extends string = string,
  A = OfZStream<AStream>,
  B = OfZStream<BStream>,
>(
  aUpstream: AStream,
  aKey: NoInfer<keyof A>,
  bUpstream: BStream,
  bKey: NoInfer<keyof B>,
  relationship: K,
) {
  type C = ReturnType<typeof multiply<A, B, K>>;
  return stream({
    push(a?: ZSet<A>, b?: ZSet<B>) {
      const bKeys = b?.[0].map((x) => ({ [aKey]: x[bKey] }));
      const aKeys = a?.[0]
        .filter((_, i) => a[1][i] > 0)
        .map((x) => ({ [bKey]: x[aKey] }));

      return SyncPromise.all([
        bKeys?.length && aUpstream.pull({ constraints: bKeys }),
        aKeys?.length && bUpstream.pull({ constraints: aKeys }),
      ] as const).then(([aPulled, bPulled]) => {
        if (aPulled) zero(aPulled);
        if (aPulled && a) add(aPulled, a);
        else if (a) aPulled = a;

        if (aPulled && b) {
          const aOrder = new Map<unknown, number>(
            aPulled[0].map((x, i) => [x[aKey], i]),
          );

          const compare = (x: B, y: B) =>
            (aOrder.get(x[bKey]) ?? Infinity) -
            (aOrder.get(y[bKey]) ?? Infinity);

          sort(b, compare);
          multiply(aPulled, aKey, b, bKey, relationship);
        }

        if (aPulled && bPulled) {
          const aRef = aPulled === a ? a : zero(copy(a));
          multiply(aRef, aKey, bPulled, bKey, relationship);
          if (aPulled !== a) add(aRef, aPulled);
          return aRef as C;
        }

        return (aPulled || zero()) as C;
      });
    },
    pull(options) {
      return SyncPromise.one(aUpstream.pull(options)).then((a) =>
        SyncPromise.all([
          a,
          bUpstream.pull({
            ...options,
            constraints: a[0].map((x) => ({ [bKey]: x[aKey] })),
          }),
        ]).then(([a, b]) => {
          return multiply(a, aKey, b, bKey, relationship);
        }),
      );
    },
  })(aUpstream, bUpstream);
}
