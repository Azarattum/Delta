import { TYPE, type Shape } from "../../datastructure/shape";
import type { ZSet } from "../../datastructure/zset";
import { stream } from "../../stream";

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

  return stream({
    pull: async ({ ordering } = {}) => {
      const store = db.transaction([table], "readonly").objectStore(table);
      let scan: T[];

      // TODO: reimplement with https://web.archive.org/web/20250212202423/https://www.codeproject.com/Articles/744986/How-to-do-some-magic-with-indexedDB
      /*const constraintColumns = Object.keys(constraints ?? {});
      if (constraintColumns.toString() === store.keyPath.toString()) {
        scan = await Promise.all(
          constraints!.map(
            (x) =>
              new Promise<T>(
                (r) =>
                  (store.get(Object.values(x) as any).onsuccess = (e: any) =>
                    r(e.target.result)),
              ),
          ),
        );
        // console.log("PK SCAN:", scan);
      } else if (store.indexNames.contains(constraintColumns.toString())) {
        const index = store.index(constraintColumns.toString());
        scan = (await Promise.all(
          constraints!.map(
            (x) =>
              new Promise<T>(
                (r) =>
                  (index[index.unique ? "get" : "getAll"](
                    Object.values(x) as any,
                  ).onsuccess = (e: any) => r(e.target.result)),
              ),
          ),
        )) as T[];
        if (!index.unique) scan = scan.flat() as T[];
        // console.log("INDEX SCAN:", scan);
      } else */ if (ordering) {
        const indexName = ordering
          .map((x) => (Array.isArray(x) ? x[0] : x))
          .join(",");

        if (!store.indexNames.contains(indexName)) {
          throw new Error(
            `Attempting to order by non-existent index: ${indexName}`,
          );
        }

        const index = store.index(indexName);
        const request = index.getAll();
        scan = (await new Promise<T>(
          (r) => (request.onsuccess = (e: any) => r(e.target.result)),
        )) as T[];
        // TODO: this is horrible, use cursor with reverse order instead!
        if (ordering[0][1] === "desc") scan = scan.reverse();
        // console.log("INDEX SCAN:", scan);
      } else {
        const request = store.getAll();
        scan = (await new Promise<T>(
          (r) => (request.onsuccess = (e: any) => r(e.target.result)),
        )) as T[];
        // console.log("FULL SCAN:", scan);
      }

      return [scan, Array(scan.length).fill(1), shape] as ZSet<T>;
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
          else store.delete(primaryKeys.map((key) => item[key[0]]) as string[]);
        }
      }

      await new Promise((resolve) => (store.transaction.oncomplete = resolve));
    },
  })(null);
}

// TODO: this is a temporary solution for testing purposes,
//  we should use a proper schema and source create in the future
export function createStore<T extends string>(
  db: IDBDatabase,
  name: string,
  shape: Shape<Record<T, any>>,
  indexed: T[] = [],
) {
  const keyPath = shape.keys.filter((_, i) => shape.types[i] & TYPE.PRIMARY);
  const store = db.createObjectStore(name, { keyPath });
  const relations = shape.keys.filter(
    (_, i) => shape.types[i] >> 16 && !(shape.types[i] & TYPE.PRIMARY),
  );

  // TODO: support compound indexes somehow...
  const indexes = new Set([...indexed, ...relations]);
  indexes.forEach((x) => store.createIndex(x, [x]));
}
