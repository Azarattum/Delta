import type { Order } from "../../datastructure/shape";
import type { Query, Store } from "./source";

export function memory<T extends Record<string, unknown>>() {
  return ((pks) => {
    const data: T[] = [];

    return {
      query<TRow extends T = T>({ filter, order, cursor, total }: Query<TRow>) {
        const reverse = cursor?.count != null && cursor.count < 0;

        let scan = data.filter((row) => {
          if (!filter) return true;
          return filter?.every(({ items, keys, exclude }) => {
            const rowKeys = keys[0];
            const refKeys = keys[1] ?? rowKeys;
            const contains = items.some((ref) => {
              return rowKeys.every((key, i) => row[key] === ref[refKeys[i]]);
            });

            return contains !== !!exclude;
          });
        });

        if (total) total.out = scan.length;

        scan = scan.sort((a, b) => compareBy(a, b, order, reverse));

        if (cursor?.anchor) {
          scan = scan.filter((row) => {
            const cmp = compareBy(row, cursor.anchor!, order, reverse);
            return cursor.exclusive ? cmp > 0 : cmp >= 0;
          });
        }

        if (cursor?.offset) scan = scan.slice(cursor.offset);
        if (cursor?.count != null) scan = scan.slice(0, Math.abs(cursor.count));
        if (reverse) scan.reverse();

        return structuredClone(scan) as TRow[];
      },
      mutate({ creates, updates, removes }) {
        removes?.forEach((row) => {
          const existing = data.findIndex((item) => samePrimary(item, row));
          if (existing >= 0) data.splice(existing, 1);
        });

        creates?.forEach((row) => {
          const existing = data.findIndex((item) => samePrimary(item, row));
          if (existing >= 0) data[existing] = structuredClone(row);
          else data.push(structuredClone(row));
        });

        updates?.forEach((row) => {
          const existing = data.find((item) => samePrimary(item, row));
          if (existing) Object.assign(existing, structuredClone(row));
        });
      },
    };

    function samePrimary(a: Partial<T>, b: Partial<T>) {
      return pks.every((key) => a[key] === b[key]);
    }
  }) satisfies Store<T>;
}

function compareBy(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  order: Order<Record<string, unknown>>,
  reverse = false,
) {
  for (const entry of order) {
    const [key, direction = "asc"] = Array.isArray(entry) ? entry : [entry];
    const sign = (direction === "asc" ? 1 : -1) * (reverse ? -1 : 1);
    const x = a[key];
    const y = b[key];

    if (x === y) continue;
    if (y == null) return sign;
    if (x == null) return -sign;

    const type = typeof x;
    if (type !== typeof y || type === "object" || type === "function") {
      throw new Error(`Unsupported compare types: ${type} ${typeof y}`);
    }

    return (x < y ? -1 : 1) * sign;
  }

  return 0;
}
