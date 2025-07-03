import { either, nest, type Shape } from "./shape";

type AsRecord<T> = T extends Record<keyof any, any> ? T : {};

type ZMetadata<T> = number[] & {
  [K in keyof AsRecord<T> as AsRecord<T>[K] extends any[] ? K
  : never]?: AsRecord<T>[K] extends (infer U)[] ? ZMetadata<U>[] : never;
};

type ZSet<T> = [data: T[], metadata: ZMetadata<T>, shape?: Shape<T>];

// TODO: we need some kind of a traverser for ZSet
//   to support singles and NESTED singles!

function add<T>(a: ZSet<T>, b: ZSet<T>) {
  if (!b[0].length) return a;
  const [aData, aMetadata, aShape] = a;
  const [bData, bMetadata, bShape] = b;
  const shape = either(aShape, bShape);

  const childrenKeys = Object.keys(shape?.children ?? {});

  let i = 0;
  let j = 0;

  while (j < bData.length) {
    const equality = i < aData.length ? compare(aData[i], bData[j], shape) : 1;
    if (equality < 0) {
      i++;
      continue;
    } else if (equality > 0) {
      // Create
      aData.splice(i, 0, bData[j]);
      aMetadata.splice(i, 0, bMetadata[j]);

      // Copy metadata. TODO: Should be recursive?
      childrenKeys.forEach((key) => {
        if (Number.isInteger(+key)) return;
        (aMetadata[key] ??= []).splice(i, 0, bMetadata[key][j]);
      });
    } else if (
      !(aData[i] === bData[j] && typeof aData[i] === "object" && aData[i])
    ) {
      // Update
      if (bMetadata[j] === 0 || aMetadata[j] === 0) {
        for (const key in bData[j]) {
          if (key in bMetadata) {
            add(
              [
                arrayify(aData[i][key]),
                arrayify(aMetadata[key]?.[i]),
                aShape?.children?.[key],
              ],
              [
                arrayify(bData[j][key]),
                arrayify(bMetadata[key]?.[j]),
                bShape?.children?.[key],
              ],
            );
          } else {
            aData[i][key] = bData[j][key];
          }
        }
      }

      aMetadata[i] = (aMetadata[i] ?? 0) + bMetadata[j];
    }

    i++;
    j++;
  }
  return a;
}

function multiply<A, B, K extends string, S extends boolean = false>(
  a: ZSet<A>,
  keyA: keyof A,
  b: ZSet<B>,
  keyB: keyof B,
  relationship: K,
  single = false as S,
) {
  const [aData, aMetadata, aShape] = a;
  const [bData, bMetadata, bShape] = b;
  const seen = new Map<A[keyof A] | B[keyof B], number>();
  (aMetadata as any)[relationship] ??= [];

  if (single) {
    for (let i = 0; i < bData.length; i++) {
      const key = bData[i][keyB];
      if (!seen.has(key)) seen.set(key, i);
    }

    for (let i = 0; i < aData.length && bData.length; i++) {
      const id = seen.get(aData[i][keyA]);
      (aData[i] as any)[relationship] ??= id != null ? bData[id] : null;
      (aMetadata as any)[relationship][i] ??= id != null ? bMetadata[id] : 0;
    }
  } else {
    for (let i = 0; i < aData.length; i++) {
      const key = aData[i][keyA];
      const cached = seen.get(key) ?? (seen.set(key, i), undefined);

      (aData[i] as any)[relationship] =
        cached === undefined ? [] : (aData[cached] as any)[relationship];
      (aMetadata as any)[relationship][i] =
        cached === undefined ? [] : (aMetadata as any)[relationship][cached];
    }

    for (let i = 0; i < bData.length; i++) {
      const id = seen.get(bData[i][keyB]);
      if (id === undefined) continue;
      (aData[id] as any)[relationship].push(bData[i]);
      (aMetadata as any)[relationship][id].push(bMetadata[i]);
    }
  }

  a[2] = nest(aShape, relationship, bShape);
  return a as ZSet<A & { [_ in K]: S extends true ? B | null : B[] }>;
}

// TODO: make distinct work on ZValues
function distinct<T>(item: ZSet<T>) {
  let index = 0;
  item[0].forEach((x, i) => {
    if (item[1][i] > 0) {
      item[0][index] = x;
      item[1][index++] = 1;
    }
  });

  item[0].length = index;
  item[1].length = index;

  Object.keys(item[2]?.children ?? {}).forEach((key) => {
    item[0].forEach((x, i) => distinct([x[key], item[1][key][i]]));
  });
  return item;
}

function zero<T>(item?: ZSet<T>) {
  if (!item) return [[], []] as ZSet<T>;

  item[1].fill(0);
  // TODO: test whether this is actually needed
  Object.keys(item[1]).forEach((key) => {
    if (Number.isInteger(+key)) return;
    item[0].forEach((x, i) => {
      if (!x[key]) return;
      if (!Array.isArray(x[key])) return (item[1][key][i] = 0);
      zero([x[key], item[1][key][i]]);
    });
  });
  return item;
}

function copy<T>(item: ZSet<T>) {
  const items = item[0].slice();
  const metadata = item[1].slice();

  const bMetadataKeys = Object.keys(item[1]).filter(
    (key) => !Number.isInteger(+key),
  );
  items.forEach((x, i) => {
    items[i] = { ...x };
    bMetadataKeys.forEach((key) => {
      if (!Array.isArray(x[key])) {
        x[key] = { ...x[key] };
        (metadata[key] ??= [])[i] = item[1][key]?.[i] ?? 0;
      } else {
        const clone = copy([x[key], item[1][key]?.[i] ?? [], item[2]?.[key]]);
        x[key] = clone![0];
        (metadata[key] ??= [])[i] = clone![1];
      }
    });
  });

  return [items, metadata, item[2]] as unknown as ZSet<T>;
}

function compare<T>(a: T, b: T, shape?: Shape<T>) {
  for (let i = 0; i < (shape?.order.length ?? 1); i++) {
    const direction = shape && shape.order[i] & 1 ? -1 : 1;
    const key = shape?.keys[shape.order[i] >> 1];
    const x = key ? a[key] : a;
    const y = key ? b[key] : b;

    if (x === y) continue;
    if (y == null) return 1 * direction;
    if (x == null) return -1 * direction;

    if (typeof x !== typeof y) {
      throw new Error(`Mismatched types: ${typeof x} ${typeof y}`);
    }

    // TODO: ensure it is OK to use localeCompare
    if (typeof x === "string") return x.localeCompare(y as string) * direction;
    if (typeof x === "number") return (x - (y as number)) * direction;
    if (typeof x === "boolean") return (x ? 1 : -1) * direction;
    throw new Error(`Unsupported compare type: ${typeof x}`);
  }

  return 0;
}

function sort<T>(item: ZSet<T>, compare: (a: T, b: T) => number) {
  item[0]
    .map((x, i) => [x, item[1][i]] as const)
    .sort((x, y) => compare(x[0], y[0]))
    .forEach((x, i) => {
      item[0][i] = x[0];
      item[1][i] = x[1];
    });

  return item;
}

// TODO: move to utils or something
function arrayify<T>(target: T | null | undefined): T extends any[] ? T : [T] {
  if (Array.isArray(target)) return target as any;
  if (target != null) return [target] as any;
  return [] as any;
}

export { add, sort, distinct, zero, copy, compare, multiply };
export type { ZMetadata, ZSet };
