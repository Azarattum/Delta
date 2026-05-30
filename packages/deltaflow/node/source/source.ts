import {
  isRelation,
  nonPrimary,
  isPrimary,
  compare,
  primary,
  reorder,
} from "../../datastructure/shape";
import type { Order, Shape } from "../../datastructure/shape";
import { zStream, type ZPullOptions, type ZStream } from "../stream";
import {
  add,
  changed,
  copy,
  create,
  remove,
  update,
  zero,
} from "../../datastructure/zset";
import type { Follows, MaybePromise, Stream } from "../../stream";
import { traverse } from "../../datastructure/metaset";
import type { ZSet } from "../../datastructure/zset";
import { couple, SyncPromise } from "../../stream";

export function source<
  TShape extends Shape<T>,
  TStore extends Store<T>,
  T extends Record<string, unknown> = TShape["~type"],
>(shape: TShape, store: TStore) {
  type NonPrimaryKey = Exclude<keyof TShape["~type"], keyof TShape["~id"]>;
  type Async = [QueryOf<TStore>];

  const { keys, types } = shape;
  const pks = primary(shape);
  const nonPks = nonPrimary(shape) as NonPrimaryKey[];
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
        push(local?: ZSet<Partial<T>>, remote?: ZSet<Partial<T>>) {
          return SyncPromise.all([
            local && reconstruct(local),
            remote && reconstruct(remote),
          ]).then(([local, remote]) => {
            if (local && localNeeded) localSource.push(copy(local));
            const set = local ?? remote ?? zero<T>();
            if (local && remote) add(set, remote);
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
              if (meta >= created) creates.push(x);
              else if (meta <= removed) removes.push(x);
              else {
                const delta: Partial<T> = {};
                keys.forEach((key: keyof T, i) => {
                  if (isPrimary(types[i])) delta[key] = x[key];
                  else if (changed(meta, shape, key)) delta[key] = x[key];
                });
                updates.push(delta);
              }
            });
          });

          return store.mutate({ creates, updates, removes });
        },
        extensions: {
          create(...items: T[]) {
            items.sort((a, b) => compare(a, b, shape));
            const meta = Array(items.length).fill(created);
            this.push([items, meta, shape] as ZSet<Partial<T>>);
            return this;
          },
          delete(...items: TShape["~id"][]) {
            items.sort((a, b) => compare(a as T, b as T, shape));
            const meta = Array(items.length).fill(removed);
            this.push([items, meta, shape] as ZSet<Partial<T>>);
            return this;
          },
          update(...items: (Partial<T> & TShape["~id"])[]) {
            items.sort((a, b) => compare(a as T, b as T, shape));
            const meta = Array(items.length).fill(updated);
            this.push([items, meta, shape] as ZSet<Partial<T>>);
            return this;
          },
          get local(): Stream<Follows<Async, ZSet<T>>, [never], ZPullOptions> {
            return localSource as any;
          },
        },
      })(null, upstream);

      couple(source, localSource);
      return source;

      function reconstruct(set: ZSet<Partial<T>>) {
        return SyncPromise.one(
          store.query({ filter: [{ keys: [pks], items: set[0] }], order }),
        ).then((current) => {
          return traverse(
            {
              combine: (data, meta, reference) => {
                if (meta >= created) return;
                if (meta <= removed) return [reference, meta];
                const changedKeys = nonPks.filter((key) => {
                  if (!(key in data)) return false;
                  if (!changed(meta, shape, key as keyof T)) return false;
                  if (data[key] === reference[key]) return false;
                  reference[key] = data[key];
                  return true;
                });

                if (!changedKeys.length) return;
                return [reference, update(shape, ...changedKeys)];
              },
              update: (data, meta) => (meta > 0 ? [data, meta] : undefined),
              insert: () => undefined,
              shallow: true,
            },
            set,
            [current, [], shape] as ZSet<Partial<T>>,
          ) as ZSet<T>;
        });
      }
    });

    return data as Follows<[ReturnType<TStore>], Awaited<typeof data>>;
  };
}

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
