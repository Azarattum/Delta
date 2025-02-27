import { add, copy, multiply, zero, type ZSet } from "../datastructure/zset";
import { stream, SyncPromise, type Stream } from "../stream";

export function join<A, B, const K extends string>(
  aUpstream: Stream<ZSet<A> | Promise<ZSet<A>>>,
  aKey: keyof A,
  bUpstream: Stream<ZSet<B> | Promise<ZSet<B>>>,
  bKey: keyof B,
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

        if (aPulled && b) multiply(aPulled, aKey, b, bKey, relationship);
        if (aPulled && bPulled) {
          const aRef = aPulled === a ? a : zero(copy(a!));
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
