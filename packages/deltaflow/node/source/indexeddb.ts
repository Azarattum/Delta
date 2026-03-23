import {
  TYPE,
  primary,
  type Order,
  type Shape,
} from "../../datastructure/shape";
import type { ZSet } from "../../datastructure/zset";
import { zStream, type PullOptions } from "../stream";

/** TODO: this is just a prototype */
export async function indexeddb<T extends Record<string, unknown>>(
  db: IDBDatabase,
  table: string,
  shape: Shape<T>,
  initialData: T[] = [],
) {
  const store = db.transaction(table, "readwrite").objectStore(table);
  // Autocreating for testing convenience (TODO: remove later)
  initialData.forEach((x) => store.put(x));
  await new Promise((resolve) => (store.transaction.oncomplete = resolve));

  const pks = primary(shape);

  return zStream({
    pull: async ({ filter, order, weight = 1 } = {}) => {
      // TODO: support cursor
      const store = db.transaction([table], "readonly").objectStore(table);
      let scan: T[];

      // TODO: support cursor and composite options
      if (filter) {
        // TODO: support exclusion filtering
        // TODO: support multiple filtering
        scan = await queryWithFilter(store, filter[0]);
      } else if (order) {
        scan = await queryWithOrder<T>(store, order);
      } else {
        scan = await new Promise<T[]>(
          (r) => (store.getAll().onsuccess = (e: any) => r(e.target.result)),
        );
      }

      return [scan, Array(scan.length).fill(weight), shape] as ZSet<T>;
    },
    flush: async (changes: [ZSet<T>][]) => {
      if (changes.length === 0) return;
      const store = db.transaction(table, "readwrite").objectStore(table);
      for (const [change] of changes) {
        for (let i = 0; i < change[0].length; i++) {
          const item = change[0][i];
          const op = change[1][i];

          if (op === 0) store.put(item);
          else if (op > 0) store.add(item);
          else store.delete(pks.map((key) => item[key] as IDBValidKey));
        }
      }

      await new Promise((resolve) => (store.transaction.oncomplete = resolve));
    },
  })(null);
}

// TODO: this is a temporary solution for testing purposes,
//  we should use a proper schema and source create in the future
export function createStore<T extends Record<string, unknown>>(
  db: IDBDatabase,
  name: string,
  shape: Shape<T>,
  indexed: (keyof T)[] = [],
) {
  const keyPath = primary(shape);
  const store = db.createObjectStore(name, { keyPath });
  const relations = shape.keys.filter(
    (_, i) => shape.types[i] >> 16 && !(shape.types[i] & TYPE.PRIMARY),
  );

  // TODO: support compound indexes somehow...
  const indexes = new Set([...indexed, ...relations]);
  indexes.forEach((x) => store.createIndex(x as string, [x as string]));
}

function queryWithFilter<T>(
  store: IDBObjectStore,
  filter: NonNullable<PullOptions["filter"]>[number],
) {
  const [indexKeys, refKeys = indexKeys] = filter.keys;
  const { index, unique } = getIndex(store, indexKeys.toString());

  // TODO: this cast is probably unsafe
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
  const direction =
    Array.isArray(order[0]) && order[0][1] === "desc" ? "prev" : "next";

  const { index } = getIndex(store, indexName);

  return new Promise<T[]>((resolve) => {
    const results: T[] = [];
    const request = index.openCursor(undefined, direction);
    request.onsuccess = (event: any) => {
      const cursor = event.target.result as IDBCursorWithValue | null;
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
