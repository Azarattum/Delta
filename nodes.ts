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
    push: (x?: Wrapper<T>) => (distinct(add(data, x!)), x!),
  })();
}

/** Stateful */
function sink<T>(downstream: Stream<Wrapper<T>>) {
  let view: Wrapper<T>;
  return stream({
    push: (x) => view && distinct(add(view, x)),
    pull: () => (view ??= distinct(downstream.pull())),
  })(downstream);
}

/** Stateless */
function filter<T>(
  downstream: Stream<Wrapper<T>>,
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
function map<T, U>(downstream: Stream<Wrapper<T>>, mapping: (x: T) => U) {
  return stream({
    push: (x: Wrapper<T>) => {
      x[0].forEach((y, i) => ((x[0] as any)[i] = mapping(y)));
      return x as unknown as Wrapper<U>;
    },
  })(downstream);
}

/** Stateless */
function join<A, B, const K extends string>(
  downstreamA: Stream<Wrapper<A>>,
  keyA: keyof A,
  downstreamB: Stream<Wrapper<B>>,
  keyB: keyof B,
  relationship: K,
) {
  type C = A & { [_ in K]: B[] };
  return stream({
    push(a?: Wrapper<A>, b?: Wrapper<B>) {
      const anyA = a?.[0].length;
      const anyB = b?.[0].length;

      let pulledA =
        anyB &&
        zero(
          downstreamA.pull({
            constraints: b[0].map((x) => ({ [keyA]: x[keyB] })),
          }),
        );
      const pulledB =
        anyA &&
        downstreamB.pull({
          constraints: a[0].map((x) => ({ [keyB]: x[keyA] })),
        });

      if (pulledA && anyA) add(pulledA, a);
      else if (anyA) pulledA = a;

      if (pulledA && anyB) multiply(pulledA, keyA, b, keyB, relationship);
      if (pulledA && pulledB) {
        return add(
          multiply(zero(copy(a)), keyA, pulledB, keyB, relationship),
          pulledA,
        ) as Wrapper<C>;
      }

      return (pulledA || [[], [], []]) as Wrapper<C>;
    },
    pull(options) {
      const a = downstreamA.pull(options);
      const b = downstreamB.pull({
        ...options,
        constraints: a![0].map((x) => ({ [keyB]: x[keyA] })),
      });
      return multiply(a, keyA, b, keyB, relationship) as Wrapper<C>;
    },
  })(downstreamA, downstreamB);
}

export { memory, sink, filter, join, map };
