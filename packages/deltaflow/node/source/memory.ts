import { add, sort, distinct, create, remove } from "../../datastructure/zset";
import { children, compare, reorder } from "../../datastructure/shape";
import type { Shape } from "../../datastructure/shape";
import type { ZSet } from "../../datastructure/zset";
import { zStream } from "../stream";

// TODO: memory is extremely incomplete compared to SQLite source!
export function memory<T extends Record<string, unknown>>(
  shape: Shape<T>,
  initialData: T[] = [],
  // TODO: allow memory to accept upstream (e.g. to allow pushes to it)
) {
  const data = [
    initialData.sort((a, b) => compare(a, b, shape)),
    Array(initialData.length).fill(create(shape)),
    shape,
  ] as ZSet<T>;

  children(shape).forEach(([key]) => {
    (data[1] as Record<string, unknown>)[key] ??= [];
    data[0].forEach(
      (x, i) =>
        (data[1][key][i] = Array((x[key] as unknown[]).length).fill(
          create((shape.children as any)[key].shape),
        )),
    );
  });

  return zStream({
    pull: ({ order, filter, cardinality: n = 1 } = {}) => {
      const scan = structuredClone(
        filter?.length ?
          data[0].filter((x) =>
            filter.every(({ items, keys, exclude }) => {
              const refKeys = keys[1] ?? keys[0];
              const contains = items.find((ref) =>
                keys[0].every((k, i) => x[k] === ref[refKeys[i]]),
              );

              return !!contains !== !!exclude;
            }),
          )
        : data[0],
      );

      const scanShape = order ? reorder(shape, ...order) : shape;
      const meta =
        n > 0 ? create(scanShape, n)
        : n < 0 ? remove(scanShape, -n)
        : 0;
      const scanMeta = Array(scan.length).fill(meta);
      const scanSet = [scan, scanMeta, scanShape] as ZSet<T>;

      if (order) sort(scanSet, (a, b) => compare(a, b, scanShape));
      // TODO: support cursor
      return scanSet;
    },
    flush: (changes) => changes.forEach(([x]) => distinct(add(data, x))),
  })(null);
}
