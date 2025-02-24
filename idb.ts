import { encodeOrder } from "./util";
import { stream } from "./stream";
import { Wrapper } from "./datastructure";

/** Stateful IDB source node (prototype) */
async function idb<T extends object>(
  db: IDBDatabase,
  table: string,
  initialData: T[],
  primaryKeys: [NoInfer<keyof T & string>, "asc" | "desc"][],
) {
  const columns = Object.keys(initialData[0]);
  const encodedOrder = encodeOrder(columns, ...primaryKeys);

  const store = db.transaction(table, "readwrite").objectStore(table);
  // Autocreating for testing convenience (TODO: remove later)
  initialData.forEach((x) => store.put(x));
  await new Promise((resolve) => (store.transaction.oncomplete = resolve));

  return stream({
    pull: async (options) => {
      const store = db.transaction([table], "readonly").objectStore(table);
      const request = store.getAll();
      let scan: T[];

      const constraintColumns = Object.keys(options?.constraints?.[0] ?? {});
      if (constraintColumns.toString() === store.keyPath.toString()) {
        scan = await Promise.all(
          options!.constraints!.map(
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
          options!.constraints!.map(
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
      } else {
        scan = (await new Promise<T>(
          (r) => (request.onsuccess = (e: any) => r(e.target.result)),
        )) as T[];
        // console.log("FULL SCAN:", scan);
      }

      return [
        scan,
        Array(scan.length).fill(1),
        encodedOrder as any[],
      ] as Wrapper<T>;
    },
    flush: async (changes: [Wrapper<T>][]) => {
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

export { idb };
