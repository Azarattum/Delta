import {
  tombstone,
  compare,
  revive,
  alive,
  remap,
  bump,
  tick,
} from "../../datastructure/clset";
import {
  changed,
  create,
  remove,
  update,
  zero,
} from "../../datastructure/zset";
import {
  nonPrimary,
  isPrimary,
  primary,
  TYPE,
  type Shape,
} from "../../datastructure/shape";
import type { CLMeta, CLSet, NextVersion } from "../../datastructure/clset";
import { traverse, type MetaSet } from "../../datastructure/metaset";
import type { ZStream, CLPullOptions, CLStream } from "../stream";
import type { ZSet } from "../../datastructure/zset";
import type { Follows, PullOf } from "../../stream";
import { stream, SyncPromise } from "../../stream";
import type { Store, QueryOf } from "./source";

type MetaRow = Record<string, unknown>; // TODO: a better type?

export function sync<
  TShape extends Shape<T>,
  TStore extends Store<Record<string, any>>,
  T extends Record<string, unknown> = TShape["~type"],
>(shape: TShape, store: TStore) {
  const pks = primary(shape);
  const nonPks = nonPrimary(shape);
  const pkCols = pks.map((key) => `pk_${key}`);
  const clocks = nonPks.map((x) => `clock_${x}`);

  const pkTypes = shape.types.filter(isPrimary);

  const keys = [...pkCols, "version", "causality", ...clocks];
  const types = [...pkTypes, TYPE.INT, TYPE.INT, ...clocks.map(() => TYPE.INT)];
  const indexes = [["version"]];

  const peers = [1, 2, 3, 4]; // TODO: TEMP STUB, need to figure out a better way to manage peer ids

  let version = 0;
  let pendingVersion = 0;
  const nextVersion: NextVersion = (mergeVersion = 0) => {
    const next = Math.max(version + 1, pendingVersion, mergeVersion);
    return (pendingVersion = next);
  };

  const rowToRef = (row: MetaRow) =>
    Object.fromEntries(pks.map((key, i) => [key, row[pkCols[i]]])) as T;

  const rowToMeta = (row: MetaRow) =>
    [row["version"], row["causality"], ...clocks.map((x) => row[x])] as CLMeta;

  const metaToRow = (data: Partial<T>, meta: CLMeta) =>
    Object.fromEntries([
      ...pks.map((key, i) => [pkCols[i], data[key]]),
      ["version", meta[0]],
      ["causality", meta[1]],
      ...clocks.map((key, i) => [key, meta[i + 2]]),
    ]) as MetaRow;

  const keyOf = (data: Partial<T>) =>
    JSON.stringify(pks.map((key) => data[key]));

  const result = SyncPromise.one(store(pkCols, keys, types, indexes)).then(
    (store) =>
      SyncPromise.one(
        store.query<MetaRow>({
          order: [["version", "desc"]],
          cursor: { count: 1 },
        }),
      ).then((rows) => {
        version = Number(rows[0]?.["version"] ?? 0);
        pendingVersion = version;

        const replicate = <TStream extends ZStream<T>>(upstream: TStream) =>
          stream({
            push(local: ZSet<T>) {
              return SyncPromise.one(
                store.query<MetaRow>({
                  order: pkCols,
                  filter: [{ keys: [pkCols, pks], items: local[0] }],
                }),
              ).then((rows) => {
                return traverse<
                  MetaSet<Record<string, unknown>, number | CLMeta>
                >(
                  {
                    combine: (_, aMeta, data, bMeta, shape) => {
                      const [clMeta, zMeta] = [
                        aMeta as CLMeta,
                        bMeta as number,
                      ];
                      return [data, cast(clMeta, zMeta, shape, nextVersion)];
                    },
                    insert: (data, meta) => {
                      const zMeta = meta as number;
                      const versions = Array(clocks.length).fill(0);
                      const clMeta: CLMeta = [nextVersion(), 0, ...versions];

                      return [data, cast(clMeta, zMeta, shape, nextVersion)];
                    },
                    update: () => undefined,
                  },
                  [rows.map(rowToRef), rows.map(rowToMeta), shape],
                  local,
                ) as CLSet<T>;
              });
            },
            pull(options?: CLPullOptions) {
              return SyncPromise.one(
                store.query<MetaRow>({
                  order: ["version"],
                  cursor: options && {
                    anchor: { version: options.version },
                    exclusive: true,
                  },
                  // TODO: optimization skip tombstones when pulling without a version
                }),
              ).then((rows) => {
                const refs = rows.map(rowToRef);
                const meta = rows.map(rowToMeta);

                return SyncPromise.one(
                  upstream.pull({
                    order: pks,
                    filter: [{ keys: [pks], items: refs }],
                  }),
                ).then(([items]) => {
                  // TODO: check if there is a better way, but since order of clMeta is different from zData...
                  const dataByKey = new Map(items.map((x) => [keyOf(x), x]));
                  const data = refs.map((ref, i) => {
                    if (alive(meta[i])) return dataByKey.get(keyOf(ref)) ?? ref;
                    else return ref;
                  });

                  return [data, meta, shape] as CLSet<T>;
                });
              }) as Follows<[QueryOf<TStore>, PullOf<TStream>], CLSet<T>>;
            },
            flush(changes) {
              const replaces = changes.flatMap(([data, meta]) =>
                data.map((x, i) => metaToRow(x, meta[i])),
              );
              if (!replaces.length) return;

              return SyncPromise.one(store.mutate({ creates: replaces })).then(
                () => void (version = pendingVersion),
              );
            },
            extensions: {
              nextVersion,
              get version() {
                return version;
              },
            },
          })(upstream);

        const reconcile = <TStream extends CLStream<T>>(
          upstream: TStream | null = null,
        ) =>
          stream({
            push(incoming: CLSet<T>) {
              // TODO: this should come from somewhere remote...
              const incomingPeers = [1, 2, 3, 4];

              // TODO: wrap query and mutate in a transaction to prevent race conditions
              return SyncPromise.one(
                store.query<MetaRow>({
                  order: pkCols,
                  filter: [{ keys: [pkCols, pks], items: incoming[0] }],
                }),
              ).then((rows) => {
                const replaces: MetaRow[] = [];
                const zset = traverse(
                  {
                    combine: (_, aMeta, data, bMeta, shape) => {
                      if (bMeta[1] < aMeta[1]) return;
                      bMeta = remap(bMeta, incomingPeers, peers);
                      if (!alive(bMeta)) {
                        replaces.push(
                          metaToRow(data, bump(bMeta, nextVersion)),
                        );
                        return [data, [bMeta, remove(shape)]] as any;
                      }

                      const changed = nonPks.filter((key, i) => {
                        const won = compare(aMeta, bMeta, i, peers) < 0;
                        if (!won) {
                          bMeta[2 + i] = aMeta[2 + i];
                          delete data[key];
                        }
                        return won;
                      });
                      // TODO: `currentPeers` might have been modified

                      replaces.push(metaToRow(data, bump(bMeta, nextVersion)));
                      if (!changed.length) return;
                      else return [data, (update as any)(shape, ...changed)]; // TODO: find a way to remove as any
                    },
                    insert: (data, meta) => {
                      replaces.push(metaToRow(data, bump(meta, nextVersion)));
                      return [data, create(shape)] as any;
                    },
                    update: () => undefined,
                  },
                  [rows.map(rowToRef), rows.map(rowToMeta), shape] as CLSet<T>,
                  incoming,
                ) as unknown as ZSet<Partial<T>>;

                // Mutate right away to preserve transactional consistency
                return SyncPromise.one(
                  store.mutate({ creates: replaces }),
                ).then(() => ((version = pendingVersion), zset));
              });
            },
            pull() {
              return zero<Partial<T>>(); // TODO: automatic version pulls for sync? better types to not require pull?
            },
          })(upstream);

        return [reconcile, replicate] as const;
      }),
  );

  return result as Follows<[ReturnType<TStore>], Awaited<typeof result>>;
}

function cast(
  clMeta: CLMeta,
  zMeta: number,
  shape: Shape<any>,
  nextVersion: NextVersion,
) {
  if (zMeta >= create(shape)) {
    return bump(revive(clMeta), nextVersion);
  } else if (zMeta <= remove(shape)) {
    return bump(tombstone(clMeta), nextVersion);
  } else {
    changed(zMeta, shape).forEach((i) => tick(clMeta, i));
    return bump(clMeta, nextVersion);
  }
}
