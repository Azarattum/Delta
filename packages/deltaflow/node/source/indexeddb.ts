import type { Order } from "../../datastructure/shape";
import type { Query, Store } from "./source";

/** TODO: this is just a prototype */
export function indexeddb<T extends Record<string, unknown>>(
  name: string,
  table: string,
) {
  return (async (pks, _, __, idx) => {
    await ensureDatabase(name, table, pks, idx);

    const primaryKey = (row: Partial<T>) =>
      pks.map((key) => row[key] as IDBValidKey);

    const objectStore = async (mode: IDBTransactionMode) => {
      const db = await ensureDatabase(name, table, pks, idx);
      return db.transaction(table, mode).objectStore(table);
    };

    return {
      query<TRow extends T = T>({
        filter,
        order,
      }: Query<TRow>): Promise<TRow[]> {
        // TODO: support cursor
        return objectStore("readonly").then((store) => {
          // TODO: support cursor and composite options
          if (filter) {
            // TODO: support exclusion filtering
            // TODO: support multiple filtering
            return queryWithFilter(store, filter[0]);
          } else if (order) {
            return queryWithOrder<TRow>(store, order);
          } else {
            return new Promise<TRow[]>((resolve) => {
              store.getAll().onsuccess = function () {
                resolve(this.result);
              };
            });
          }
        });
      },
      async mutate({ creates, updates, removes }) {
        if (!creates?.length && !updates?.length && !removes?.length) return;

        const store = await objectStore("readwrite");

        removes?.forEach((row) => store.delete(primaryKey(row)));
        creates?.forEach((row) => store.put(row));
        updates?.forEach((row) => {
          const request = store.get(primaryKey(row));
          request.onsuccess = function () {
            const current = this.result;
            if (current) store.put({ ...current, ...row });
          };
        });

        await new Promise(
          (resolve) => (store.transaction.oncomplete = resolve),
        );
      },
    };
  }) satisfies Store<T>;
}

const cache = new Map<string, { ready: Promise<IDBDatabase | void> }>();

async function ensureDatabase(
  name: string,
  table: string,
  pks: readonly string[],
  indexes: readonly (readonly string[])[],
) {
  const item = cache.get(name) ?? { ready: Promise.resolve() };
  cache.set(name, item);

  return (item.ready = item.ready.then(async (db) => {
    db ??= await openDatabase(name);
    if (hasSchema(db, table, pks, indexes)) return db;

    db.close();
    return (db = await openDatabase(name, db.version + 1, (db, transaction) =>
      createStore(db, transaction, table, pks, indexes),
    ));
  })) as Promise<IDBDatabase>;
}

function openDatabase(
  name: string,
  version?: number,
  upgrade?: (db: IDBDatabase, transaction: IDBTransaction) => void,
) {
  const request = indexedDB.open(name, version);
  request.onupgradeneeded = () =>
    upgrade?.(request.result, request.transaction!);

  return new Promise<IDBDatabase>((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

function hasSchema(
  db: IDBDatabase,
  table: string,
  pks: readonly string[],
  indexes: readonly (readonly string[])[],
) {
  if (!db.objectStoreNames.contains(table)) return false;

  const store = db.transaction(table, "readonly").objectStore(table);
  if (store.keyPath?.toString() !== pks.toString()) return false;
  return indexes.every((index) => store.indexNames.contains(index.toString()));
}

function createStore(
  db: IDBDatabase,
  transaction: IDBTransaction,
  name: string,
  pks: readonly string[],
  indexes: readonly (readonly string[])[],
) {
  const store =
    db.objectStoreNames.contains(name) ?
      transaction.objectStore(name)
    : db.createObjectStore(name, { keyPath: [...pks] });

  indexes.forEach((index) => {
    const name = index.toString();
    if (store.indexNames.contains(name)) return;
    store.createIndex(name, [...index]);
  });
}

function queryWithFilter<T>(
  store: IDBObjectStore,
  filter: NonNullable<Query<Record<string, unknown>>["filter"]>[number],
) {
  const [indexKeys, refKeys = indexKeys] = filter.keys;
  const { index, unique } = getIndex(store, indexKeys.toString());

  // TODO: this cast is probably unsafe, also handle when `refs.length === 0`
  const refs = (filter.items as Record<string, IDBValidKey>[])
    .map((x) => refKeys.map((k) => x[k]))
    .sort((a, b) => {
      for (let i = 0; i < refKeys.length; i++) {
        const cmp = indexedDB.cmp(a[i], b[i]);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });

  let i = 0;
  const next = () => ++i < refs.length;

  const results: T[] = [];
  return new Promise<T[]>((resolve) => {
    index.openCursor(IDBKeyRange.lowerBound(refs[i])).onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (!cursor) return resolve(results);

      let cmp = indexedDB.cmp(cursor.key, refs[i]);
      while (cmp > 0 && next()) cmp = indexedDB.cmp(cursor.key, refs[i]);

      if (cmp > 0) return resolve(results);
      if (cmp < 0) return cursor.continue(refs[i]);

      results.push(cursor.value);
      if (unique && !next()) return resolve(results);
      cursor.continue(unique ? refs[i] : undefined);
    };
  });
}

async function queryWithOrder<T>(store: IDBObjectStore, order: Order<T>) {
  const indexName = order.map((x) => (Array.isArray(x) ? x[0] : x)).toString();
  // TODO: fully support compound indexes (currently order is inferred only from the first key)
  const direction =
    Array.isArray(order[0]) && order[0][1] === "desc" ? "prev" : "next";

  const { index } = getIndex(store, indexName);

  return new Promise<T[]>((resolve) => {
    const results: T[] = [];
    const request = index.openCursor(undefined, direction);
    request.onsuccess = function () {
      const cursor = this.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
  });
}

function getIndex(store: IDBObjectStore, name: string) {
  const byPrimaryKey = name === store.keyPath?.toString();
  // TODO: only check in dev
  if (!byPrimaryKey && !store.indexNames.contains(name)) {
    throw new Error(`Attempting to query by non-existent index: ${name}`);
  }

  const index = byPrimaryKey ? store : store.index(name);
  const unique = byPrimaryKey || (index as IDBIndex).unique;
  return { index, unique };
}
