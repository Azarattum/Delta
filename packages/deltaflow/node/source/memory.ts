import { children, compare, reorder, TYPE } from "../../datastructure/shape";
import { zStream, clStream, type OfZStream, type ZStream } from "../stream";
import type { CLGlobal, CLMeta, CLSet } from "../../datastructure/clset";
import { add, sort, distinct } from "../../datastructure/zset";
import type { Shape } from "../../datastructure/shape";
import type { ZSet } from "../../datastructure/zset";
import { SyncPromise } from "../../stream";

export function memory<T extends Record<string, any>>(
  shape: Shape<T>,
  initialData: T[] = [],
  // TODO: allow memory to accept upstream (e.g. to allow pushes to it)
) {
  const data = [
    initialData.sort((a, b) => compare(a, b, shape)),
    Array(initialData.length).fill(1),
    shape,
  ] as ZSet<T>;

  children(shape).forEach(([key]) => {
    (data[1] as Record<string, unknown>)[key] ??= [];
    data[0].forEach((x, i) => (data[1][key][i] = Array(x[key].length).fill(1)));
  });

  return zStream({
    pull: ({ ordering, constraints, weight = 1 } = {}) => {
      const checks = constraints && Object.entries(constraints);
      const scan = structuredClone(
        checks ?
          data[0].filter((x) => checks.every(([k, v]) => v.has(x[k])))
        : data[0],
      );

      const scanShape = ordering ? reorder(shape, ...ordering) : shape;
      const scanMeta = Array(scan.length).fill(weight);
      const scanSet = [scan, scanMeta, scanShape] as ZSet<T>;

      if (ordering) sort(scanSet, (a, b) => compare(a, b, scanShape));
      return scanSet;
    },
    flush: (changes) => changes.forEach(([x]) => distinct(add(data, x))),
  })(null);
}

export function memoryReplication<
  TStream extends ZStream<T>,
  T = OfZStream<TStream>,
>(dataStream: TStream, global: CLGlobal, initialData: [number, CLMeta][] = []) {
  // TODO: use generic key, not a number
  const stored = new Map<number, CLMeta>(initialData);

  return clStream({
    pull(options) {
      return SyncPromise.one(dataStream.pull(options)).then((zset) => {
        const [data, _, shape] = zset;

        const emptyCols =
          shape?.keys
            .filter((_, i) => !(shape.types[i] & TYPE.PRIMARY))
            .flatMap(() => [0, global.peer]) ?? [];

        // TODO: do not use the ID, but actual key!
        const meta = data.map(
          (x) =>
            // TODO: I'm not sure if fallback here is a good idea...
            stored.get((x as any).id) ?? [global.version, 0, ...emptyCols],
        );

        return [data, meta, shape] as unknown as CLSet<T>;
      });
    },
  })(null);
}
