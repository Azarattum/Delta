type ZMetadata<T> = number[] & {
  [K in keyof T as T[K] extends any[] ? K : never]?: T[K] extends (infer U)[] ?
    ZMetadata<U>[]
  : never;
};

type Order<T> = number[] & {
  [K in keyof T as T[K] extends any[] ? K : never]?: T[K] extends (infer U)[] ?
    Order<U>[]
  : never;
};

type ZSet<T> = [data: T[], metadata: ZMetadata<T>, order?: Order<T>];

function add<T>(a: ZSet<T>, b: ZSet<T>) {
  const [aData, aMetadata, aOrder] = a;
  const [bData, bMetadata, bOrder] = b;
  const keys =
    typeof aData[0] === "object" && aData[0] ?
      (Object.keys(aData[0]) as (keyof T)[])
    : undefined;
  const bMetadataKeys = Object.keys(bMetadata).filter(
    (key) => !Number.isInteger(+key),
  );

  if (!aOrder) throw new Error("Destination must be ordered!");
  if (bOrder?.length && bOrder.toString() !== aOrder.toString()) {
    throw new Error(`Mismatched order: ${aOrder} and ${bOrder}`);
  }

  let i = 0;
  let j = 0;

  while (j < bData.length) {
    const equality =
      i < aData.length ? compare(aData[i], bData[j], aOrder, keys) : 1;
    if (equality < 0) {
      i++;
      continue;
    } else if (equality === 0) {
      // Update
      if (bMetadata[j] === 0 || aMetadata[j] === 0) {
        for (const key in bData[j]) {
          if (key in bMetadata) {
            if (aMetadata[key]?.[i] == null) {
              (aData as any)[i][key] = bData[j][key];
              (aMetadata as any)[key] ??= [];
              (aMetadata as any)[key][i] = bMetadata[key]?.[j].slice() ?? [];
              (aOrder as any)[key] ??= bOrder?.[key]?.slice();
            } else {
              add(
                [
                  aData[i][key] as unknown[],
                  (aMetadata as any)[key][i],
                  (aOrder as any)[key],
                ],
                [
                  bData[j][key] as unknown[],
                  bMetadata[key]?.[j] ?? [],
                  (bOrder as any)?.[key],
                ],
              );
            }
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
      bMetadataKeys.forEach((key) => {
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
  // TODO: this would go through a precision fetch, and no longer manual index be needed
  const rightIndex = new Map<A[keyof A] | B[keyof B], number[]>(); // TODO: Would be good to cache

  for (let i = 0; i < b[0].length; i++) {
    const key = b[0][i][keyB];
    if (!rightIndex.has(key)) rightIndex.set(key, []);
    rightIndex.get(key)!.push(i);
  }

  for (let i = 0; i < a[0].length; i++) {
    const matches = rightIndex.get(a[0][i][keyA]) || [];
    // TODO: refactor
    (a[0][i] as any)[relationship] = matches.map((x) => b[0][x]);
    ((a[1] as any)[relationship] ??= [])[i] = matches.map((x) => b[1][x]);
  }
  ((a[2] as any) ??= [])[relationship] ??= b[2];

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

  Object.keys(item[1]).forEach((key) => {
    if (Number.isInteger(+key)) return;
    item[0].forEach((x, i) => x[key] && distinct([x[key], item[1][key][i]]));
  });
  return item;
}

function zero<T>(item: ZSet<T>) {
  item[1].fill(0);
  // TODO: test whether this is actually needed
  Object.keys(item[1]).forEach((key) => {
    if (Number.isInteger(+key)) return;
    item[0].forEach((x, i) => x[key] && zero([x[key], item[1][key][i]]));
  });
  return item;
}

function copy<T>(item: ZSet<T>) {
  const items = item[0].slice();
  const metadata = item[1].slice();
  const order = item[2]?.slice();

  const bMetadataKeys = Object.keys(item[1]).filter(
    (key) => !Number.isInteger(+key),
  );
  items.forEach((x, i) => {
    items[i] = { ...x };
    bMetadataKeys.forEach((key) => {
      const clone = copy([x[key], item[1][key][i], item[2]?.[key]]);
      x[key] = clone[0];
      (metadata[key] ??= [])[i] = clone[1];
      if (order) order[key] = clone[2];
    });
  });

  return [items, metadata, order] as unknown as ZSet<T>;
}

function compare<T>(a: T, b: T, order: number[], keys?: (keyof T)[]) {
  for (let i = 0; i < order.length; i++) {
    const direction = order[i] & 1 ? -1 : 1;
    const key = keys?.[order[i] >> 1];
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

export { add, distinct, zero, copy, compare, multiply };
export type { ZMetadata, ZSet };
