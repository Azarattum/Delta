import { add, distinct, Wrapper, multiply } from "./datastructure";
import { Stream, stream } from "./stream";

/** Stateful */
function memory<T>(initialData: T[], compare: (a: T, b: T) => number) {
  const data = [
    initialData.sort(compare),
    Array(initialData.length).fill(1),
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
        options?.zero ? Array(scan.length).fill(0) : structuredClone(data[1]),
      ] as Wrapper<T>;
    },
    push: (x?: Wrapper<T>) => (distinct(add(data, x!, compare)), x!),
  })();
}

/** Stateful */
function sink<T>(
  downstream: Stream<Wrapper<T>>,
  compare: (a: T, b: T) => number,
) {
  let view: Wrapper<T>;
  return stream({
    push: (x) => distinct(add(view, x, compare)),
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
  return stream({
    // TODO: try to unify this implementations, also adapt for future batching
    push(a: Wrapper<A>, b: Wrapper<B>) {
      return multiply(a, keyA, b, keyB, relationship);
    },
    pull(options) {
      const a = downstreamA.pull(options);
      const b = downstreamB.pull({
        ...options,
        constraints: a![0].map((x) => ({ [keyB]: x[keyA] })),
      });
      return multiply(a, keyA, b, keyB, relationship);
    },
    fetch(a, b) {
      a ??= downstreamA.pull({
        constraints: b![0].map((x) => ({ [keyA]: x[keyB] })),
        zero: true,
      });
      b ??= downstreamB.pull({
        constraints: a![0].map((x) => ({ [keyB]: x[keyA] })),
      });
      return [a, b] as const;
    },
  })(downstreamA, downstreamB);
}

export { memory, sink, filter, join, map };
