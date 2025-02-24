import {
  add,
  distinct,
  Wrapper,
  multiply,
  compare,
  zero,
  copy,
} from "./datastructure";
import { Stream, stream } from "./stream";
import { SyncPromise } from "./sync-promise";
import { encodeOrder } from "./util";

/** Stateful */
function memory<T>(
  initialData: T[],
  ...order: [NoInfer<keyof T & string>, "asc" | "desc"][]
) {
  if (!initialData[0]) {
    throw new Error("Must have at least one item to infer order");
  }
  const keys =
    typeof initialData[0] === "object" && initialData[0] ?
      (Object.keys(initialData[0]) as (keyof T)[])
    : undefined;
  const encodedOrder = encodeOrder(keys, ...order);
  const data = [
    initialData.sort((a, b) => compare(a, b, encodedOrder, keys)),
    Array(initialData.length).fill(1),
    encodedOrder as any[],
  ] as Wrapper<T>;

  return stream({
    pull: (options) => {
      let scan =
        options?.constraints ?
          options.constraints.flatMap((constraint) => {
            return structuredClone(
              // This will be faster with a real DB
              data[0].filter((x) =>
                Object.entries(constraint).every(([k, v]) => x[k] === v),
              ),
            );
          })
        : structuredClone(data[0]);

      return [
        scan,
        options?.constraints ?
          Array(scan.length).fill(1)
        : structuredClone(data[1]),
        structuredClone(data[2]),
      ] as Wrapper<T>;
    },
    push: (x: Wrapper<T>) => (distinct(add(data, x!)), x!),
  })(null);
}

/** Stateful */
function sink<T>(
  downstream: Stream<Wrapper<T> | Promise<Wrapper<T>>>,
  zero = [[], [], []] as Wrapper<T>,
) {
  let view: Promise<Wrapper<T>> | Wrapper<T>;
  const pullView = () =>
    (view = SyncPromise.one(downstream.pull()).then((x) => (view = x)));

  return stream({
    push: (x: Wrapper<T>) => {
      if (!view) return zero;
      return SyncPromise.one(view).then((view) => distinct(add(view, x)));
    },
    pull: () => {
      if (!view) pullView();
      if (view instanceof Promise) return zero;
      return view;
    },
    flush: () => SyncPromise.one(view ?? pullView()).then(() => void 0),
  })(downstream);
}

/** Stateless */
function filter<T>(
  downstream: Stream<Wrapper<T> | Promise<Wrapper<T>>>,
  predicate: (x: T) => boolean,
) {
  return stream({
    push: (x: Wrapper<T>) => {
      let index = 0;
      x[0].forEach((y, i) => {
        if (predicate(y)) {
          x[0][index] = y;
          x[1][index++] = x[1][i];
        }
      });
      x[0].length = index;
      x[1].length = index;
      return x;
    },
  })(downstream);
}

/** Stateless */
function map<T, U>(
  downstream: Stream<Wrapper<T> | Promise<Wrapper<T>>>,
  mapping: (x: T) => U,
) {
  return stream({
    push: (x: Wrapper<T>) => {
      x[0].forEach((y, i) => ((x[0] as any)[i] = mapping(y)));
      return x as unknown as Wrapper<U>;
    },
  })(downstream);
}

/** Stateless */
function join<A, B, const K extends string>(
  downstreamA: Stream<Wrapper<A> | Promise<Wrapper<A>>>,
  keyA: keyof A,
  downstreamB: Stream<Wrapper<B> | Promise<Wrapper<B>>>,
  keyB: keyof B,
  relationship: K,
) {
  type C = A & { [_ in K]: B[] };
  return stream({
    push(a?: Wrapper<A>, b?: Wrapper<B>) {
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
          return add(
            multiply(zero(copy(a!)), keyA, pulledB, keyB, relationship),
            pulledA,
          ) as Wrapper<C>;
        }

        return (pulledA || [[], [], []]) as Wrapper<C>;
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
          return multiply(a, keyA, b, keyB, relationship) as Wrapper<C>;
        }),
      );
    },
  })(downstreamA, downstreamB);
}

export { memory, sink, filter, join, map };
