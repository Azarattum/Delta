import {
  add,
  distinct,
  ZSet,
  multiply,
  compare,
  copy,
  zero,
} from "./datastructure";
import { Stream, stream } from "./stream";
import { SyncPromise } from "./sync-promise";
import { encodeOrder } from "./util";
import type { CLMetadata, CLSet } from "./crdt";

/** Stateful */
function memory<T>(
  initialData: T[],
  ...order: [NoInfer<keyof T & string>, "asc" | "desc"][]
  // TODO: allow memory to accept downstream (e.g. to allow pushes to it)
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
  ] as ZSet<T>;

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
      ] as ZSet<T>;
    },
    push: (x: ZSet<T>) => (distinct(add(data, x!)), x!),
  })(null);
}

/** Stateful */
function sink<T>(
  downstream: Stream<ZSet<T> | Promise<ZSet<T>>>,
  initial = zero(),
) {
  let view: Promise<ZSet<T>> | ZSet<T>;
  const pullView = () =>
    (view = SyncPromise.one(downstream.pull()).then((x) => (view = x)));

  return stream({
    push: (x: ZSet<T>) => {
      if (!view) return initial;
      return SyncPromise.one(view).then((view) => distinct(add(view, x)));
    },
    pull: () => {
      if (!view) pullView();
      if (view instanceof Promise) return initial;
      return view;
    },
    flush: () => SyncPromise.one(view ?? pullView()).then(() => void 0),
  })(downstream);
}

/** Stateless */
function filter<T>(
  downstream: Stream<ZSet<T> | Promise<ZSet<T>>>,
  predicate: (x: T) => boolean,
) {
  return stream({
    push: (x: ZSet<T>) => {
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
  downstream: Stream<ZSet<T> | Promise<ZSet<T>>>,
  mapping: (x: T) => U,
) {
  return stream({
    push: (x: ZSet<T>) => {
      x[0].forEach((y, i) => ((x[0] as any)[i] = mapping(y)));
      return x as unknown as ZSet<U>;
    },
  })(downstream);
}

/** Stateless */
function join<A, B, const K extends string>(
  downstreamA: Stream<ZSet<A> | Promise<ZSet<A>>>,
  keyA: keyof A,
  downstreamB: Stream<ZSet<B> | Promise<ZSet<B>>>,
  keyB: keyof B,
  relationship: K,
) {
  type C = A & { [_ in K]: B[] };
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
          return refA as ZSet<C>;
        }

        return (pulledA || zero()) as ZSet<C>;
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
          return multiply(a, keyA, b, keyB, relationship) as ZSet<C>;
        }),
      );
    },
  })(downstreamA, downstreamB);
}

function fork<T, S extends Stream<ZSet<T> | Promise<ZSet<T>>>>(
  downstream: S,
  count = 2,
) {
  // TODO: this should not be a promise....
  const clone = stream({ push: (x: ZSet<T>) => copy(x) });
  const forks = Array.from({ length: count }).map(() => clone(downstream));
  // TODO: this should be inferred automatically
  return forks as unknown as S[];
}

// TODO: come up with a better name
/** Stateful */
function memoryMergeMetadata<T>(
  dataStream: Stream<ZSet<T> | Promise<ZSet<T>>>,
  clientID: number,
  initialData: [number, CLMetadata][] = [],
) {
  // TODO: use generic key, not a number
  const meta = new Map<number, CLMetadata>(initialData);
  let version = initialData.reduce((a, b) => Math.max(a, b[1][0]), 0);

  return stream({
    pull(options) {
      return SyncPromise.one(dataStream.pull(options)).then((zset) => {
        const [data, _, order] = zset;

        // TODO: put this away from here
        const keys =
          typeof data[0] === "object" && data[0] ?
            (Object.keys(data[0]).filter((_, i) =>
              order ? order.every((y) => y >> 1 !== i) : true,
            ) as (keyof T)[])
          : undefined;

        const emptyCols = keys?.flatMap(() => [0, clientID]) || [];
        // TODO: do not use the ID, but actual key!
        const metadata = data.map(
          (x) =>
            // TODO: I'm not sure if fallback here is a good idea...
            meta.get((x as any).id) ?? [version, 0, ...emptyCols],
        );

        return [data, metadata, order] as unknown as CLSet<T>;
      });
    },
  })(null);
}

// TODO: come up with a better name
/** Stateless */
function z2cl<T>(
  downstreamA: Stream<ZSet<T> | Promise<ZSet<T>>>,
  downstreamB: Stream<CLSet<T> | Promise<CLSet<T>>>,
  clientID: number,
) {
  return stream({
    push(a: ZSet<T>) {
      // TODO: don't use id here!
      const keysA = a?.[0]
        .filter((_, i) => a[1][i] <= 0)
        .map((x) => ({ id: x["id"] }));

      // TODO: CLSet should also have a zero type (or maybe unite them?)
      if (!keysA) return [[], [], []] as CLSet<T>;
      return SyncPromise.one(downstreamB.pull({ constraints: keysA })).then(
        (pulled) => {
          // TODO: put this away from here
          const keys =
            typeof a[0][0] === "object" && a[0][0] ?
              (Object.keys(a[0][0]).filter((_, i) =>
                pulled[2] ? pulled[2].every((y) => y >> 1 !== i) : true,
              ) as (keyof T)[])
            : undefined;
          const initCols = keys?.flatMap(() => [1, clientID]) || [];

          let j = 0;
          for (let i = 0; i < a[0].length; i++) {
            // Create
            if (a[1][i] > 0) {
              // TODO: embed version in CLSet and client
              (a[1][i] as any) = [Infinity, 1, ...initCols];
              continue;
            }

            // Pulled have their own counter
            const referenceItem = pulled[0][j];
            const referenceMeta = pulled[1][j];
            j++;

            // Delete
            if (a[1][i] < 0) {
              if (!referenceMeta) {
                throw new Error("Trying to delete non-existent item!");
              }
              (a[1][i] as any) = [
                Infinity,
                referenceMeta[1] % 2 ? referenceMeta[1] + 1 : referenceMeta[1],
              ];
            }
            // Update
            else {
              /// TODO: support noop updates
              if (!keys) throw new Error("Noop updates are not supported");
              if (!referenceItem || !referenceMeta) {
                throw new Error("Trying to update non-existent item!");
              }
              (a[1][i] as any) = referenceMeta;

              // TODO: use real version here
              a[1][i][0] = Infinity;
              for (let j = 2; j < referenceMeta.length; j += 2) {
                const key = keys[(j - 2) / 2];
                if (a[0][i][key] !== referenceItem[key]) {
                  a[1][i][j + 1] = clientID;
                  a[1][i][j]++;
                }
              }
            }
          }

          // TODO: make sure the order types are compatible in the future
          (a[2] as any) ??= pulled[2];
          return a as unknown as CLSet<T>;
        },
      );
    },
    pull(options) {
      // TODO: implement pulling with version constraint
      throw new Error("Pulling for changes is not implemented yet");
    },
  })(downstreamA);
}

export { memory, sink, filter, join, map, fork, z2cl, memoryMergeMetadata };
