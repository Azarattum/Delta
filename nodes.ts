import { add, distinct, Wrapper, multiply, zero } from "./datastructure";
import { Stream, stream } from "./stream";

/** Stateful */
function memory<T>(initialData: Wrapper<T>) {
  const data = initialData;
  return stream({
    pull: () => structuredClone(data),
    push: (x?) => (distinct(add(data, x!)), x!),
  })();
}

/** Stateful */
function sink<T>(downstream: Stream<Wrapper<T>>) {
  let view: Wrapper<T>;
  return stream({
    push: (x) => distinct(add(view, x)),
    pull: () => (view ??= downstream.pull()),
  })(downstream);
}

/** Stateless */
function filter<T>(
  downstream: Stream<Wrapper<T>>,
  predicate: (x: T) => boolean
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
  relationship: K
) {
  return stream({
    push(a: Wrapper<A>, b: Wrapper<B>) {
      return multiply(a, keyA, b, keyB, relationship);
    },
    fetch(a, b) {
      // TODO: add more precision to the pulls (eg. ZQL's constraints)
      a ??= zero(downstreamA.pull());
      b ??= downstreamB.pull();
      return [a, b] as const;
    },
  })(downstreamA, downstreamB);
}

export { memory, sink, filter, join, map };
