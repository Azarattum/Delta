import type {
  InferItem,
  Visitors,
  MetaSet,
  Recurse,
  Visit,
} from "./metaset.types";
import { children, compare, either, type Children } from "./shape";
import { shared } from "./metaset.types";

function traverse<T extends MetaSet>(fns: Visitors<T>, target: T, source?: T) {
  const shape = either(target[2], source?.[2]);
  const childKeys = children(shape);
  const deep = visit(fns, childKeys);

  const { container } = fns;
  if (container) {
    target[0] = container(target[0], false);
    target[1] = container(target[1], !!childKeys.length) as (typeof target)[1];
    childKeys.forEach(([key, { shape }]) => {
      target[1][key] = container(target[1][key], !!children(shape).length);
    });
  }

  const [tData, tMeta] = target;
  const [sData, sMeta] = source ?? [[], []];

  let deleted = 0;
  let i = 0;
  let j = 0;

  while (j < sData.length || i < tData.length) {
    const cmp =
      -(j >= sData.length) ||
      +(i >= tData.length) ||
      compare(tData[i], sData[j], shape);

    const next =
      cmp < 0 ? deep("update", [tData[i]], [tMeta], [i], deleted)
      : cmp > 0 ? deep("insert", [sData[j]], [sMeta, tMeta], [j, i], deleted)
      : deep("combine", [tData[i], sData[j]], [tMeta, sMeta], [i, j], deleted);

    const ti = i - deleted;
    if (!next) cmp <= 0 && deleted++;
    else if (cmp <= 0) [tData[ti], tMeta[ti]] = next;
    else {
      tData.splice(ti, 0, next[0]);
      tMeta.splice(ti, 0, next[1]);
    }

    if (cmp >= 0) i++, j++;
    else i++;
  }

  if (deleted) {
    tData.length -= deleted;
    tMeta.length -= deleted;

    (function pruneChildren(childKeys, meta) {
      childKeys.forEach(([key, { single, shape }]) => {
        meta[key].length -= deleted;
        if (single) pruneChildren(children(shape), meta[key]);
      });
    })(childKeys, tMeta);
  }

  return target;
}

function visit<T extends MetaSet>(
  fns: Visitors<T>,
  childKeys: Children<T>,
): Visit<T> {
  return (type, items, metas, idx, deleted) => {
    const result: InferItem<T> | undefined =
      type === "delete" ? undefined
      : !fns[type] ? [items[0], metas[0][idx[0] - deleted]]
      : (fns[type] as any)(...items.flatMap((x, i) => [x, metas[i][idx[i]]]));

    if (!childKeys.length) return result;
    if (!result) type = "delete";

    const isInsert = type === "insert";
    const fns2 = isInsert ? { ...fns, update: fns.insert } : fns;
    const resultIdx = idx[+isInsert] - deleted;
    const resultMeta = metas[+isInsert];

    childKeys.forEach(([key, { single, shape }]) => {
      if (!(idx[0] in metas[0][key]) || (!single && !result)) return;
      const items2 = items.map((x) => x[key]);
      const metas2 = metas.map((x, i) => (single ? x[key] : x[key]?.[idx[i]]));

      const next =
        single ?
          visit<any>(fns, children(shape))(type, items2, metas2, idx, deleted)
        : recurse<MetaSet>(items2, metas2, shape, fns2);

      if (isInsert) resultMeta[key].splice(resultIdx, 0, metas2[0][idx[0]]);
      if (next) [result![0][key], resultMeta[key][resultIdx]] = next;
      else {
        if (result) delete result[0][key];
        delete resultMeta[key][resultIdx];
      }
    });

    return result;
  };
}

const recurse: Recurse = ([tData, sData], [tMeta, sMeta], shape, fns) =>
  traverse<any>(fns, [tData, tMeta, shape], sData && [sData, sMeta]);

export { shared, traverse, type MetaSet, type Visitors };
