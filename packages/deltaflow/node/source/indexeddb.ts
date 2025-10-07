import { TYPE, type Shape } from "../../datastructure/shape";
import type { ZSet } from "../../datastructure/zset";
import { zStream } from "../stream";

/** TODO: this is just a prototype */
export async function indexeddb<T extends object>(
  db: IDBDatabase,
  table: string,
  shape: Shape<T>,
  initialData: T[] = [],
) {
  const store = db.transaction(table, "readwrite").objectStore(table);
  // Autocreating for testing convenience (TODO: remove later)
  initialData.forEach((x) => store.put(x));
  await new Promise((resolve) => (store.transaction.oncomplete = resolve));

  const primaryKeys = shape.keys.filter(
    (_, i) => shape.types[i] & TYPE.PRIMARY,
  );

  return zStream({
    pull: async ({ constraints, ordering, range, weight = 1 } = {}) => {
      if (range) throw new Error("TODO: support range in indexeddb source");
      const store = db.transaction([table], "readonly").objectStore(table);
      let scan: T[];

      if (constraints) {
        scan = await queryWithConstraints(store, constraints);
      } else if (ordering) {
        scan = await queryWithOrdering(store, ordering);
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
          else store.delete(primaryKeys.map((key) => item[key]) as string[]);
        }
      }

      await new Promise((resolve) => (store.transaction.oncomplete = resolve));
    },
  })(null);
}

// TODO: this is a temporary solution for testing purposes,
//  we should use a proper schema and source create in the future
export function createStore<T extends Record<string, any>>(
  db: IDBDatabase,
  name: string,
  shape: Shape<T>,
  indexed: (keyof T)[] = [],
) {
  const keyPath = shape.keys.filter((_, i) => shape.types[i] & TYPE.PRIMARY);
  const store = db.createObjectStore(name, { keyPath });
  const relations = shape.keys.filter(
    (_, i) => shape.types[i] >> 16 && !(shape.types[i] & TYPE.PRIMARY),
  );

  // TODO: support compound indexes somehow...
  const indexes = new Set([...indexed, ...relations]);
  indexes.forEach((x) => store.createIndex(x as string, [x as string]));
}

function queryWithConstraints<T>(
  store: IDBObjectStore,
  constraints: Record<keyof any, Set<IDBValidKey>>,
) {
  const indexName = Object.keys(constraints).sort().toString();
  const byPrimaryKey = indexName === store.keyPath?.toString();
  // TODO: only check in dev
  if (!byPrimaryKey && !store.indexNames.contains(indexName)) {
    throw new Error(`Attempting to query by non-existent index: ${indexName}`);
  }

  const index = byPrimaryKey ? store : store.index(indexName);
  const unique = byPrimaryKey || (index as IDBIndex).unique;
  const keyPath =
    Array.isArray(index.keyPath) ? index.keyPath : [index.keyPath!];
  const reference = keyPath.map((k) =>
    Array.from(constraints[k]).sort(indexedDB.cmp),
  );

  const indices = keyPath.map(() => 0);
  let key: IDBValidKey = indices.map((x, i) => reference[i][x]);

  function advanceKey() {
    for (let i = keyPath.length - 1; i >= 0; i--) {
      if (++indices[i] < reference[i].length) {
        for (let j = i + 1; j < keyPath.length; j++) indices[j] = 0;
        key = indices.map((x, i) => reference[i][x]);
        return true;
      }
    }
    return false;
  }

  const results: T[] = [];
  return new Promise<T[]>((resolve) => {
    index.openCursor(IDBKeyRange.lowerBound(key)).onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (!cursor) return resolve(results);

      let cmp = indexedDB.cmp(cursor.key, key);
      while (cmp > 0 && advanceKey()) cmp = indexedDB.cmp(cursor.key, key);

      if (cmp > 0) return resolve(results);
      if (cmp < 0) return cursor.continue(key);

      results.push(cursor.value);
      if (unique && !advanceKey()) return resolve(results);
      cursor.continue(unique ? key : undefined);
    };
  });
}

async function queryWithOrdering<T>(
  store: IDBObjectStore,
  ordering: (keyof any | [keyof any, ("asc" | "desc")?])[],
) {
  const indexName = ordering
    .map((x) => (Array.isArray(x) ? x[0] : x))
    .toString();
  // TODO: only check in dev
  if (!store.indexNames.contains(indexName)) {
    throw new Error(`Attempting to order by non-existent index: ${indexName}`);
  }

  const index = store.index(indexName);
  const request = index.getAll();
  let scan = (await new Promise<T>(
    (r) => (request.onsuccess = (e: any) => r(e.target.result)),
  )) as T[];
  // TODO: this is horrible, use cursor with reverse order instead!
  if (Array.isArray(ordering[0]) && ordering[0][1] === "desc") {
    scan = scan.reverse();
  }
  return scan;
}
