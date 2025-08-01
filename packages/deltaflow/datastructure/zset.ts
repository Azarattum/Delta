import { traverse, type MetaSet } from "./metaset";
import { nest } from "./shape";

type ZSet<T> = MetaSet<T, number>;

function add<T>(a: ZSet<T>, b: ZSet<T>) {
  if (!b[0].length) return a;
  return traverse(
    {
      combine(aData, aMeta, bData, bMeta) {
        const isObject = typeof aData === "object" && aData;

        if (aData === bData && isObject) {
          return [aData, aMeta];
        }

        if (aMeta === 0 || bMeta === 0) {
          if (!isObject) return [bData, aMeta + bMeta];
          for (const key in aData) {
            if (typeof aData[key] !== "object") aData[key] = bData![key];
          }
        }

        return [aData, aMeta + bMeta];
      },
    },
    a,
    b,
  );
}

// TODO: consider if multiply can be recursive an any way?
function multiply<A, B, K extends string, S extends boolean = false>(
  a: ZSet<A>,
  aKey: keyof A,
  b: ZSet<B>,
  bKey: keyof B,
  relationship: K,
  single = false as S,
) {
  const [aData, aMeta, aShape] = a;
  const [bData, bMeta, bShape] = b;
  const seen = new Map<A[keyof A] | B[keyof B], number>();
  (aMeta as any)[relationship] ??= [];

  if (single) {
    for (let i = 0; i < bData.length; i++) {
      const key = bData[i][bKey];
      if (!seen.has(key)) seen.set(key, i);
    }

    for (let i = 0; i < aData.length && bData.length; i++) {
      const id = seen.get(aData[i][aKey]);
      (aData[i] as any)[relationship] ??= id != null ? bData[id] : null;
      (aMeta as any)[relationship][i] ??= id != null ? bMeta[id] : 0;
    }
  } else {
    for (let i = 0; i < aData.length; i++) {
      const key = aData[i][aKey];
      const cached = seen.get(key) ?? (seen.set(key, i), undefined);

      (aData[i] as any)[relationship] =
        cached === undefined ? [] : (aData[cached] as any)[relationship];
      (aMeta as any)[relationship][i] =
        cached === undefined ? [] : (aMeta as any)[relationship][cached];
    }

    for (let i = 0; i < bData.length; i++) {
      const id = seen.get(bData[i][bKey]);
      if (id === undefined) continue;
      (aData[id] as any)[relationship].push(bData[i]);
      (aMeta as any)[relationship][id].push(bMeta[i]);
    }
  }

  a[2] = nest(aShape, relationship, bShape, single);
  return a as ZSet<A & { [_ in K]: S extends true ? B | null : B[] }>;
}

function distinct<T>(item: ZSet<T>) {
  return traverse(
    { update: (data, meta) => (meta > 0 ? [data, 1] : undefined) },
    item,
  );
}

function zero<T>(item?: ZSet<T>) {
  if (!item) return [[], []] as ZSet<T>;
  return traverse({ update: (data) => [data, 0] }, item);
}

function copy<T>(item: ZSet<T>) {
  return traverse(
    {
      update: (data, meta) => [{ ...data }, meta],
      container: (container, deep): any =>
        deep ? Object.assign([], container) : container.slice(),
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
