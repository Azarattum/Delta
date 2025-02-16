type Metadata<T> = number[] & {
  [K in keyof T as T[K] extends any[] ? K : never]?: T[K] extends (infer U)[] ?
    Metadata<U>[]
  : never;
};

type Wrapper<T> = [T[], Metadata<T>];

function add<T>(
  a: Wrapper<T>,
  b: Wrapper<T>,
  compare?: (a: T, b: T) => number,
) {
  const [aData, aMetadata] = a;
  const [bData, bMetadata] = b;

  let i = 0;
  let j = 0;

  while (j < bData.length) {
    const equality =
      i < aData.length && compare ? compare(aData[i], bData[j]) : 1;
    if (equality < 0) {
      i++;
      continue;
    } else if (equality === 0) {
      // Update
      if (bMetadata[j] === 0) {
        for (const key in bData[j]) {
          if (key in bMetadata) {
            if (aMetadata[key]?.[i] == null) {
              (aData as any)[i][key] = bData[j][key];
              (aMetadata as any)[key] ??= [];
              (aMetadata as any)[key][i] = bMetadata[key]?.[j].slice() ?? [];
            } else {
              add(
                [aData[i][key] as unknown[], (aMetadata as any)[key][i]],
                [bData[j][key] as unknown[], bMetadata[key]?.[j] ?? []],
                compare as (a: unknown, b: unknown) => number, // TODO: this is wrong! children might have a different compare
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
      Object.keys(bMetadata).forEach((key) => {
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
  a: Wrapper<A>,
  keyA: keyof A,
  b: Wrapper<B>,
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
    const matchingRights = rightIndex.get(a[0][i][keyA]) || [];
    // TODO: optimize
    (a[0][i] as any)[relationship] = matchingRights.map((x) => b[0][x]);
    (a[1] as any)[relationship] ??= [];
    (a[1] as any)[relationship][i] = matchingRights.map((x) => b[1][x]);
  }

  return a as Wrapper<A & { [_ in K]: B[] }>;
}

function distinct<T>(item: Wrapper<T>) {
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

function zero<T>(item: Wrapper<T>) {
  item[1].fill(0);
  Object.keys(item[1]).forEach((key) => {
    if (Number.isInteger(+key)) return;
    item[0].forEach((x, i) => x[key] && zero([x[key], item[1][key][i]]));
  });
  return item;
}

export { add, distinct, zero, multiply };
export type { Metadata, Wrapper };
