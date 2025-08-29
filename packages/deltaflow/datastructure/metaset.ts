import { shared, type MetaSet, type Visitors } from "./metaset.types";
import { children, compare, either } from "./shape";

function traverse<T extends MetaSet>(fns: Visitors<T>, target: T, source?: T) {
  const shape = either(target[2], source?.[2]);
  const childKeys = children(shape);

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

  const recurse = ([tData, sData], [tMeta, sMeta], [i, j], shape, fns) =>
    traverse<any>(fns, [tData, tMeta[i], shape], sData && [sData, sMeta[j]]);

  const deep = visitor(recurse, childKeys, fns);

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

// TODO: add types
function visitor(recurse, childKeys, fns) {
  return (type, items, metas, idx, del) => {
    const result =
      type === "delete" ? undefined
      : fns[type] ? fns[type](...items.flatMap((x, i) => [x, metas[i][idx[i]]]))
      : [items[0], metas[0][idx[0] - del]];

    if (!childKeys.length) return result;
    if (!result) type = "delete";

    const isInsert = type === "insert";
    const fns2 = isInsert ? { ...fns, update: fns.insert } : fns;
    const resultIdx = idx[+isInsert] - del;
    const resultMeta = metas[+isInsert];

    childKeys.forEach(([key, { single, shape }]) => {
      if (!(idx[0] in metas[0][key]) || (!single && !result)) return;
      const items2 = items.map((x) => x[key]);
      const metas2 = metas.map((x) => x[key]);

      const next =
        single ?
          visitor(recurse, children(shape), fns)(type, items2, metas2, idx, del)
        : recurse(items2, metas2, idx, shape, fns2);

      if (isInsert) resultMeta[key].splice(resultIdx, 0, metas2[0][idx[0]]);
      if (next) [result[0][key], resultMeta[key][resultIdx]] = next;
      else {
        if (result) delete result[0][key];
        delete resultMeta[key][resultIdx];
      }
    });

    return result;
  };
}

export { shared, traverse, type MetaSet, type Visitors };
