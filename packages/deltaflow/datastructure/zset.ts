import { traverse, type MetaSet } from "./metaset";
import { nest } from "./shape";

type ZSet<T> = MetaSet<T, number>;

function add<T>(a: ZSet<T>, b: ZSet<T>) {
  if (!b[0].length) return a;
  return traverse(
    {
      combine: (data1, weight1, data2, weight2) => {
        const isObject = typeof data1 === "object" && data1;

        if (data1 === data2 && isObject) {
          return [data1, weight1];
        }

        if (weight1 === 0 || weight2 === 0) {
          if (!isObject) return [data2, weight1 + weight2];
          for (const key in data1) {
            if (typeof data1[key] !== "object") data1[key] = data2![key];
          }
        }

        return [data1, weight1 + weight2];
      },
    },
    a,
    b,
  );
}

// TODO: consider if multiply can be recursive an any way?
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

  a[2] = nest(aShape, relationship, bShape, single);
  return a as ZSet<A & { [_ in K]: S extends true ? B | null : B[] }>;
}

function distinct<T>(item: ZSet<T>) {
  return traverse(
    {
      collection: (items, weights) => {
        const length = Math.max(items.length, weights.length);

        let left = 0;
        for (let i = 0; i < length; i++) {
          if (i >= weights.length || weights[i] <= 0) continue;
          if (i < items.length) items[left] = items[i];
          weights[left++] = 1;
        }

        items.length = Math.min(items.length, left);
        weights.length = Math.min(weights.length, left);

        return [items, weights];
      },
    },
    item,
  );
}

function zero<T>(item?: ZSet<T>) {
  if (!item) return [[], []] as ZSet<T>;
  return traverse({ item: (item) => [item, 0] }, item);
}

function copy<T>(item: ZSet<T>) {
  return traverse(
    {
      item: (item, weight) => [{ ...item }, weight],
      collection: (items, weights) => [
        items.slice(),
        Object.assign([], weights),
      ],
    },
    [...item],
  );
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

export { add, sort, distinct, zero, copy, multiply };
export type { ZSet };
