import { recurse, traverse, type MetaSet } from "./metaset";
import { children, compare, nest, TYPE } from "./shape";

type ZSet<T> = MetaSet<T, number>;

function add<T>(a: ZSet<T>, b: ZSet<T>, collapseFKs = true) {
  if (!b[0].length) return a;

  return traverse(
    {
      combine: (_, aMeta, bData, bMeta) => [bData, aMeta + bMeta],
      compare:
        collapseFKs ? compare : (
          (aData, bData, shape) => {
            const cmp = compare(aData, bData, shape);
            if (cmp !== 0 || !shape) return cmp;
            return -shape.types.some((x, i) => {
              if (!(x & TYPE.RELATION)) return false;
              const key = shape.keys[i];
              return aData[key] !== bData[key];
            });
          }
        ),
    },
    a,
    b,
  );
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

function cut<T>(item: ZSet<T>, limit: number, offset = 0) {
  item[0].splice(0, offset);
  item[0].splice(limit);
  item[1].splice(0, offset);
  item[1].splice(limit);
  spliceMeta([item[1]], children(item[2]), limit, offset);
  return item;
}

const initMeta = recurse(([meta], key) => (meta[key] ??= []));
const pushMeta = recurse(([aMeta, bMeta], key, i: number) =>
  aMeta[key].push(bMeta[key][i]),
);
const spliceMeta = recurse(([meta], key, limit: number, offset = 0) => {
  meta[key].splice(0, offset);
  meta[key].splice(limit);
});

export { add, cut, sort, distinct, zero, copy, multiply };
export type { ZSet };
