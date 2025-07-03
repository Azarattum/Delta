import { add, copy, multiply, zero } from "../datastructure/zset";
import { stream, SyncPromise, type ValidKey } from "../stream";
import type { ZSet } from "../datastructure/zset";
import type { OfZStream, ZStream } from "./type";

export function join<
  const AStream extends ZStream<A>,
  const BStream extends ZStream<B>,
  const K extends string = string,
  A = OfZStream<AStream>,
  B = OfZStream<BStream>,
  S extends boolean = false,
>(
  aUpstream: AStream,
  aKey: NoInfer<ValidKeysOf<A>>,
  bUpstream: BStream,
  bKey: NoInfer<ValidKeysOf<B>>,
  relationship: K,
  single = false as S,
) {
  type C = ReturnType<typeof multiply<A, B, K, S>>;
  return stream({
    push(a?: ZSet<A>, b?: ZSet<B>) {
      const bKeys = b && {
        [aKey]: new Set(b?.[0].map((x) => x[bKey] as ValidKey)),
      };
      const aKeys = a && {
        [bKey]: new Set(
          a[0].filter((_, i) => a[1][i] > 0).map((x) => x[aKey] as ValidKey),
        ),
      };

      return SyncPromise.all([
        bKeys?.[aKey].size && aUpstream.pull({ constraints: bKeys }),
        aKeys?.[bKey].size && bUpstream.pull({ constraints: aKeys }),
      ] as const).then(([aPulled, bPulled]) => {
        if (aPulled) zero(aPulled);
        if (aPulled && a) add(aPulled, a);
        else if (a) aPulled = a;

        if (aPulled && b) {
          multiply(aPulled, aKey, b, bKey, relationship, single);
        }

        if (aPulled && bPulled) {
          const aRef = aPulled === a ? a : zero(a && copy(a));
          multiply(aRef, aKey, bPulled, bKey, relationship, single);
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
            constraints: {
              [bKey]: new Set(a[0].map((x) => x[aKey] as ValidKey)),
            },
          }),
        ]).then(([a, b]) => {
          return multiply(a, aKey, b, bKey, relationship, single);
        }),
      );
    },
  })(aUpstream, bUpstream);
}

type ValidKeysOf<T> = {
  [K in keyof T]: T[K] extends ValidKey ? K : never;
}[keyof T] &
  string;
