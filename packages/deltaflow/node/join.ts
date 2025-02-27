import { add, copy, multiply, zero, type ZSet } from "../datastructure/zset";
import { stream, SyncPromise, type Stream } from "../stream";

export function join<A, B, const K extends string>(
  downstreamA: Stream<ZSet<A> | Promise<ZSet<A>>>,
  keyA: keyof A,
  downstreamB: Stream<ZSet<B> | Promise<ZSet<B>>>,
  keyB: keyof B,
  relationship: K,
) {
  type C = ReturnType<typeof multiply<A, B, K>>;
  return stream({
    push(a?: ZSet<A>, b?: ZSet<B>) {
      const keysB = b?.[0].map((x) => ({ [keyA]: x[keyB] }));
      const keysA = a?.[0]
        .filter((_, i) => a[1][i] > 0)
        .map((x) => ({ [keyB]: x[keyA] }));

      return SyncPromise.all([
        keysB?.length && downstreamA.pull({ constraints: keysB }),
        keysA?.length && downstreamB.pull({ constraints: keysA }),
      ] as const).then(([pulledA, pulledB]) => {
        if (pulledA) zero(pulledA);
        if (pulledA && a) add(pulledA, a);
        else if (a) pulledA = a;

        if (pulledA && b) multiply(pulledA, keyA, b, keyB, relationship);
        if (pulledA && pulledB) {
          const refA = pulledA === a ? a : zero(copy(a!));
          multiply(refA, keyA, pulledB, keyB, relationship);
          if (pulledA !== a) add(refA, pulledA);
          return refA as C;
        }

        return (pulledA || zero()) as C;
      });
    },
    pull(options) {
      return SyncPromise.one(downstreamA.pull(options)).then((a) =>
        SyncPromise.all([
          a,
          downstreamB.pull({
            ...options,
            constraints: a[0].map((x) => ({ [keyB]: x[keyA] })),
          }),
        ]).then(([a, b]) => {
          return multiply(a, keyA, b, keyB, relationship);
        }),
      );
    },
  })(downstreamA, downstreamB);
}
