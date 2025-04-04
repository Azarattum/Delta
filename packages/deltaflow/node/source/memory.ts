import { add, compare, distinct, type ZSet } from "../../datastructure/zset";
import type { CLMetadata, CLSet } from "../../datastructure/clset";
import { TYPE, type Shape } from "../../datastructure/shape";
import { stream, SyncPromise } from "../../stream";
import type { OfZStream, ZStream } from "../type";

export function memory<T>(
  shape: Shape<T>,
  initialData: T[] = [],
  // TODO: allow memory to accept upstream (e.g. to allow pushes to it)
) {
  const data = [
    initialData.sort((a, b) => compare(a, b, shape)),
    Array(initialData.length).fill(1),
    shape,
  ] as ZSet<T>;

  Object.keys(shape.children ?? {}).forEach((key) => {
    data[1][key] ??= [];
    data[0].forEach((x, i) => (data[1][key][i] = Array(x[key].length).fill(1)));
  });

  return stream({
    pull: (options) => {
      let scan =
        options?.constraints ?
          options.constraints.flatMap((constraint) => {
            return structuredClone(
              // This will be faster with a real DB
              data[0].filter((x) =>
                Object.entries(constraint).every(([k, v]) => x[k] === v),
              ),
            );
          })
        : structuredClone(data[0]);

      return [
        scan,
        options?.constraints ?
          Array(scan.length).fill(1)
        : structuredClone(data[1]),
        shape,
      ] as ZSet<T>;
    },
    flush: (changes) => changes.forEach(([x]) => distinct(add(data, x))),
  })(null);
}

export function memoryReplication<
  TStream extends ZStream<T>,
  T = OfZStream<TStream>,
>(
  dataStream: TStream,
  clientID: number,
  initialData: [number, CLMetadata][] = [],
) {
  // TODO: use generic key, not a number
  const meta = new Map<number, CLMetadata>(initialData);
  let version = initialData.reduce((a, b) => Math.max(a, b[1][0]), 0);

  return stream({
    pull(options) {
      return SyncPromise.one(dataStream.pull(options)).then((zset) => {
        const [data, _, shape] = zset;

        const emptyCols =
          shape?.keys
            .filter((_, i) => !(shape.types[i] & TYPE.PRIMARY))
            .flatMap(() => [0, clientID]) ?? [];

        // TODO: do not use the ID, but actual key!
        const metadata = data.map(
          (x) =>
            // TODO: I'm not sure if fallback here is a good idea...
            meta.get((x as any).id) ?? [version, 0, ...emptyCols],
        );
        Object.assign(metadata, { version, peer: clientID });

        return [data, metadata, shape] as unknown as CLSet<T>;
      });
    },
  })(null);
}
