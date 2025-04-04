import { either, nest, type Shape } from "./shape";

type ZMetadata<T> = number[] & {
  [K in keyof T as T[K] extends any[] ? K : never]?: T[K] extends (infer U)[] ?
    ZMetadata<U>[]
  : never;
};

type ZSet<T> = [data: T[], metadata: ZMetadata<T>, shape?: Shape<T>];

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
    } else if (equality === 0) {
      // Update
      if (bMetadata[j] === 0 || aMetadata[j] === 0) {
        for (const key in bData[j]) {
          if (key in bMetadata) {
            add(
              [
                aData[i][key] as any[],
                (aMetadata as any)[key][i],
                aShape?.children?.[key],
              ],
              [
                bData[j][key] as any[],
                bMetadata[key]?.[j] ?? [],
                bShape?.children?.[key],
              ],
            );
          } else {
            aData[i][key] = bData[j][key];
          }
        }
      }

      aMetadata[i] = (aMetadata[i] ?? 0) + bMetadata[j];
    } else {
      // Create
      aData.splice(i, 0, bData[j]);
      aMetadata.splice(i, 0, bMetadata[j]);

      // Copy metadata. TODO: Should be recursive?
      childrenKeys.forEach((key) => {
        if (Number.isInteger(+key)) return;
        aMetadata[key].splice(i, 0, bMetadata[key][j]);
      });
    }

    i++;
    j++;
  }
  return a;
}

function multiply<A, B, K extends string>(
  a: ZSet<A>,
  keyA: keyof A,
  b: ZSet<B>,
  keyB: keyof B,
  relationship: K,
) {
  const [aData, aMetadata, aShape] = a;
  const [bData, bMetadata, bShape] = b;

  for (let i = 0; i < aData.length; i++) {
    (aData[i] as any)[relationship] = [];
    ((aMetadata as any)[relationship] ??= [])[i] = [];
  }

  let i = 0;
  let j = 0;

  while (i < aData.length && j < bData.length) {
    if (compare<unknown>(aData[i][keyA], bData[j][keyB])) i++;
    else {
      (aData[i] as any)[relationship].push(bData[j]);
      (aMetadata as any)[relationship][i].push(bMetadata[j]);
      j++;
    }
  }

  a[2] = nest(aShape, relationship, bShape);
  return a as ZSet<A & { [_ in K]: B[] }>;
}

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
    item[0].forEach((x, i) => x[key] && zero([x[key], item[1][key][i]]));
  });
  return item;
}

function copy<T>(item?: ZSet<T>) {
  if (!item) return item;
  const items = item[0].slice();
  const metadata = item[1].slice();

  const bMetadataKeys = Object.keys(item[1]).filter(
    (key) => !Number.isInteger(+key),
  );
  items.forEach((x, i) => {
    items[i] = { ...x };
    bMetadataKeys.forEach((key) => {
      const clone = copy([x[key], item[1][key][i], item[2]?.[key]]);
      x[key] = clone![0];
      (metadata[key] ??= [])[i] = clone![1];
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

export { add, sort, distinct, zero, copy, compare, multiply };
export type { ZMetadata, ZSet };
