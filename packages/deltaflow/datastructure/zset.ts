import { recurse, traverse, type MetaSet } from "./metaset";
import { children, nest } from "./shape";
import { has, mark } from "./object";

type ZSet<T> = MetaSet<T, number>;

function add<T>(a: ZSet<T>, b: ZSet<T>) {
  if (!b[0].length) return a;

  const result = traverse(
    {
      combine(aData, aMeta, bData, bMeta) {
        if (!(aMeta + bMeta)) mark(bData, previous, oldest(aData));
        return [bData, aMeta + bMeta];
      },
    },
    a,
    b,
  );

  return result;
}

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
  const childKeys = children(bShape);

  (aMeta as any)[relationship] ??= [];

  if (single) {
    initMeta([aMeta[relationship]], childKeys);
    for (let i = 0; i < bData.length; i++) {
      const key = bData[i][bKey];
      if (!seen.has(key)) seen.set(key, i);
    }

    for (let i = 0; i < aData.length && bData.length; i++) {
      const id = seen.get(aData[i][aKey]);
      if (id === undefined) continue;
      (aData[i] as any)[relationship] = bData[id];
      (aMeta as any)[relationship][i] = bMeta[id];
      pushMeta([aMeta[relationship], bMeta], childKeys, id);
    }
  } else {
    for (let i = 0; i < aData.length; i++) {
      const key = aData[i][aKey];
      const cached = seen.get(key) ?? (seen.set(key, i), undefined);

      (aData[i] as any)[relationship] =
        cached === undefined ? [] : (aData[cached] as any)[relationship];
      (aMeta as any)[relationship][i] =
        cached === undefined ? [] : (aMeta as any)[relationship][cached];
      if (cached === undefined) initMeta([aMeta[relationship][i]], childKeys);
    }

    for (let i = 0; i < bData.length; i++) {
      const id = seen.get(bData[i][bKey]);
      if (id === undefined) continue;
      (aData[id] as any)[relationship].push(bData[i]);
      (aMeta as any)[relationship][id].push(bMeta[i]);
      pushMeta([aMeta[relationship][id], bMeta], childKeys, i);
    }
  }

  (a as MetaSet)[2] = nest(aShape, relationship, bShape, single);
  return a as ZSet<
    Omit<A, K> & (S extends true ? { [_ in K]?: B } : { [_ in K]: B[] })
  >;
}

function distinct<T>(item: ZSet<T>) {
  return traverse(
    {
      update: (data, meta) => {
        if (meta <= 0) return;
        if (has(data, previous)) delete data[previous];
        return [data, 1];
      },
    },
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

function expand<T>(item: ZSet<T>, key: keyof T) {
  const childKeys = children(item[2]);

  item[0].forEach((x, i) => {
    if (item[1][i] !== 0) return;
    if (!has(x, previous, key) || x[key] === x[previous][key]) return;

    item[1][i] = 1;
    item[1].splice(i, 0, -1);
    copyMeta([item[1]], childKeys, i);
    item[0].splice(i, 0, x[previous] as T);
    delete (x as any)[previous];
  });

  return item;
}

const initMeta = recurse(([meta], key) => (meta[key] ??= []));
const pushMeta = recurse(([aMeta, bMeta], key, i: number) =>
  aMeta[key].push(bMeta[key][i]),
);
const copyMeta = recurse(([meta], key, i: number) => {
  meta[key].splice(i, 0, meta[key][i]);
});

const oldest = <T>(x: T): T =>
  has(x, previous) ? (oldest(x[previous]) as T) : x;

export const previous = Symbol("previous");
export { add, sort, distinct, zero, copy, expand, multiply };
export type { ZSet };
