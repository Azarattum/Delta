import {
  isRelation,
  isPrimary,
  compare,
  primary,
  reorder,
} from "../../datastructure/shape";
import type { Order, Shape } from "../../datastructure/shape";
import { zStream, type ZPullOptions, type ZStream } from "../stream";
import {
  materialize,
  changed,
  create,
  remove,
  update,
  copy,
  zero,
  add,
} from "../../datastructure/zset";
import type { Follows, MaybePromise, Stream } from "../../stream";
import type { ZSet } from "../../datastructure/zset";
import { couple, SyncPromise } from "../../stream";

export function source<
  TShape extends Shape<T>,
  TStore extends Store<T>,
  T extends Record<string, unknown> = TShape["~type"],
>(shape: FlatOnly<TShape>, store: TStore) {
  type Async = [QueryOf<TStore>];

  const { keys, types } = shape;
  const pks = primary(shape);
  const idx = keys
    .filter((_, i) => isRelation(types[i]) && !isPrimary(types[i]))
    .map((key) => [key]);
  const order = shape.order.map((entry) => {
    const key = shape.keys[entry >> 1] as keyof T & string;
    return [key, entry & 1 ? "desc" : "asc"] as const;
  });

  const created = create(shape);
  const removed = remove(shape);
  const updated = update(shape);

  return <TStream extends ZStream<Partial<T>>>(
    upstream: TStream | null = null,
  ) => {
    const data = SyncPromise.one(store(pks, keys, types, idx)).then((store) => {
      let localNeeded = true;
      const localSource = zStream({
        push: (x: ZSet<T>) => x,
        pull: (options) => source.pull(options),
        init: () => ((localNeeded = true), () => (localNeeded = false)),
      })(null);

      const source = zStream({
        push(
          local?: ZSet<Partial<T>>,
          remote?: ZSet<Partial<T>>,
          unsafe?: ZSet<T>,
        ) {
          return SyncPromise.all([
            local && reconstruct(local),
            remote && reconstruct(remote),
          ]).then(([local, remote]) => {
            const localSet = local ?? unsafe;
            if (local && unsafe) add(localSet!, unsafe);
            if (localSet && localNeeded) localSource.push(copy(localSet));

            const set = localSet ?? remote ?? zero<T>();
            if (set !== remote && remote) add(set, remote);
            return set;
          });
        },
        pull({ cardinality = 1, ...rest } = {}) {
          const queryShape = rest.order ? reorder(shape, ...rest.order) : shape;
          const query = { order, ...rest } as Query<T>;
          return SyncPromise.one(store.query(query)).then((rows) => {
            const meta =
              cardinality > 0 ? create(queryShape, cardinality)
              : cardinality < 0 ? remove(queryShape, -cardinality)
              : 0;

            return [rows, Array(rows.length).fill(meta), queryShape] as ZSet<T>;
          }) as Follows<Async, ZSet<T>>;
        },
        flush(changes) {
          const removes: Partial<T>[] = [];
          const updates: Partial<T>[] = [];
          const creates: T[] = [];

          changes.forEach((set) => {
            set[0].forEach((x, i) => {
              const meta = set[1][i];
              if (meta >= created) creates.push({ ...x });
              else if (meta <= removed) {
                const delta: Partial<T> = {};
                pks.forEach((key: keyof T) => (delta[key] = x[key]));
                removes.push(delta);
              } else {
                const delta: Partial<T> = {};
                keys.forEach((key: keyof T, i) => {
                  if (isPrimary(types[i])) delta[key] = x[key];
                  else if (changed(meta, shape, key)) delta[key] = x[key];
                });
                updates.push(delta);
              }
            });
          });

          return () => store.mutate({ removes, creates, updates });
        },
        extensions: {
          create(...items: T[]) {
            items.sort((a, b) => compare(a, b, shape));
            const meta = Array(items.length).fill(created);
            this.push([items, meta, shape] as ZSet<Partial<T>>);
            return this;
          },
          createUnsafe(...items: T[]) {
            const meta = Array(items.length).fill(created);
            this.push(undefined, undefined, [items, meta, shape] as ZSet<T>);
            return this;
          },
          delete(...items: TShape["~id"][]) {
            items.sort((a, b) => compare(a as T, b as T, shape));
            const meta = Array(items.length).fill(removed);
            this.push([items, meta, shape] as ZSet<Partial<T>>);
            return this;
          },
          deleteUnsafe(...items: T[]) {
            const meta = Array(items.length).fill(removed);
            this.push(undefined, undefined, [items, meta, shape] as ZSet<T>);
            return this;
          },
          update(...items: (Partial<T> & TShape["~id"])[]) {
            items.sort((a, b) => compare(a as T, b as T, shape));
            const meta = Array(items.length).fill(updated);
            this.push([items, meta, shape] as ZSet<Partial<T>>);
            return this;
          },
          updateUnsafe(...items: readonly [old: T, next: T][]) {
            const data: T[] = [];
            const meta: number[] = [];

            items.forEach(([old, next]) => {
              let relation = false;
              let mask = 0;
              let bit = 1;

              keys.forEach((key, i) => {
                if (isPrimary(types[i])) return;
                if (old[key] !== next[key]) {
                  (mask += bit), (relation ||= isRelation(types[i]));
                }
                bit *= 2;
              });

              if (!mask) return;

              if (relation || compare(old, next, shape) !== 0) {
                data.push(old, next);
                meta.push(removed, created);
              } else {
                data.push(next);
                meta.push(mask);
              }
            });

            this.push(undefined, undefined, [data, meta, shape] as ZSet<T>);
            return this;
          },
          get local(): Stream<Follows<Async, ZSet<T>>, [never], ZPullOptions> {
            return localSource as any;
          },
        },
      })(null, upstream, null);

      couple(source, localSource);
      return source.eager();

      function reconstruct(set: ZSet<Partial<T>>) {
        return SyncPromise.one(
          store.query({ filter: [{ keys: [pks], items: set[0] }], order }),
        ).then((current) => materialize(set, current));
      }
    });

    return data as Follows<[ReturnType<TStore>], Awaited<typeof data>>;
  };
}

type FlatOnly<TShape extends Shape<any>> =
  keyof NonNullable<TShape>["children"] extends never ? TShape : never;

export type Mutations<T extends Record<string, unknown>> = {
  updates?: Partial<T>[];
  removes?: Partial<T>[];
  creates?: T[];
};

export type Query<T extends Record<string, unknown>> = {
  /** Order to pull in */
  order: Order<T>;

  /** Apply filtering based on the provided subset */
  filter?: {
    /** Keys to filter by (optionally reference keys if not the same) */
    keys: readonly [srcKeys: readonly string[], refKeys?: readonly string[]];
    /** Reference items to filter by */
    items: readonly Partial<T>[];
    /** Whether to exclude the items instead of including them */
    exclude?: boolean;
  }[];

  /** Cursor for precise pagination control */
  cursor?: {
    /** Anchoring element to start pagination from */
    anchor?: T;
    /** Whether to exclude the anchoring element itself */
    exclusive?: boolean;
    /** Non-negative offset from the anchor. If no anchor, from start/end (depends on count direction) */
    offset?: number;
    /** Number of elements to retrieve (positive for forward, negative for backward) */
    count?: number;
  };
  /** Mutable out-parameter for total row count (ignores cursor, respects filters) */
  total?: { out: number };
};

export type Store<T extends Record<string, unknown>> = <TRow extends T = T>(
  pks: (keyof TRow & string)[],
  keys: readonly (keyof TRow & string)[],
  types: readonly number[],
  idx: (keyof TRow & string)[][],
) => MaybePromise<{
  mutate<TRow extends T = T>(mutations: Mutations<TRow>): MaybePromise<void>;
  query<TRow extends T = T>(options: Query<TRow>): MaybePromise<TRow[]>;
}>;

export type StoreOf<TStore extends Store<any>> = Awaited<ReturnType<TStore>>;

export type QueryOf<TStore extends Store<any>> = ReturnType<
  StoreOf<TStore>["query"]
>;
