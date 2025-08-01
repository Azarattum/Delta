import { shared, type MetaSet, type Visitors } from "./metaset.types";
import { children, compare, either } from "./shape";

function traverse<T extends MetaSet>(fns: Visitors<T>, target: T, source?: T) {
  const { container, update, insert, combine } = fns;
  const shape = either(target[2], source?.[2]);
  const childKeys = children(shape);

  if (container) {
    target[0] = container(target[0], false);
    target[1] = container(target[1], !!childKeys.length) as (typeof target)[1];
    childKeys.forEach(([key, { shape }]) => {
      target[1][key] = container!(target[1][key], !!children(shape).length);
    });
  }

  const [tData, tMeta] = target;
  const [sData, sMeta] = source ?? [[], []];

  const recurse = ([tData, sData], [tMeta, sMeta], [i, j], shape) =>
    traverse<any>(fns, [tData, tMeta[i], shape], sMeta && [sData, sMeta[j]]);

  const deep = visitor(recurse, childKeys);
  const insertMetaDeep = inserter(childKeys, tMeta, sMeta);

  let deleted = 0;
  let i = 0;
  let j = 0;

  while (j < sData.length || i < tData.length) {
    const cmp =
      -(j >= sData.length) ||
      +(i >= tData.length) ||
      compare(tData[i], sData[j], shape);

    const next =
      cmp === 0 ? deep(combine, [tData[i], sData[j]], [tMeta, sMeta], [i, j])
      : cmp > 0 ? deep(insert, [sData[j]], [sMeta], [j])
      : deep(update, [tData[i]], [tMeta], [i]);

    const ti = i - deleted;
    if (!next) cmp <= 0 && deleted++;
    else if (cmp <= 0) [tData[ti], tMeta[ti]] = next;
    else {
      tData.splice(ti, 0, next[0]);
      tMeta.splice(ti, 0, next[1]);
      insertMetaDeep(ti, j);
    }

    if (cmp >= 0) i++, j++;
    else i++;
  }

  if (deleted) {
    tData.length -= deleted;
    tMeta.length -= deleted;
  }

  return target;
}

// TODO: add types
function visitor(recurse, childKeys) {
  return (fn, items, metas, idx, deleted = false) => {
    if (fn) {
      const next = fn(...items.flatMap((x, i) => [x, metas[i][idx[i]]]));
      if (next) [items[0], metas[0][idx[0]]] = next;
      else deleted = true;
    }

    childKeys.forEach(([key, { single, shape }]) => {
      if (!(idx[0] in metas[0][key])) return;
      const items2 = items.map((x) => x[key]);
      const metas2 = metas.map((x) => x[key]);

      const next =
        single ?
          visitor(recurse, children(shape))(fn, items2, metas2, idx, deleted)
        : recurse(items2, metas2, idx, shape);

      if (deleted) metas[0][key].splice(idx[0], 1);
      else {
        if (next) [items[0][key], metas[0][key][idx[0]]] = next;
        else {
          delete items[0][key];
          delete metas[0][key][idx[0]];
        }
      }
    });

    return deleted ? undefined : [items[0], metas[0][idx[0]]];
  };
}

// TODO: add types
function inserter(childKeys, tMeta, sMeta) {
  return (i, j) => {
    childKeys.forEach(([key, { single, shape }]) => {
      tMeta[key].splice(i, 0, sMeta[key][j]);
      if (single) inserter(children(shape), tMeta[key], sMeta[key])(i, j);
    });
  };
}

export { shared, traverse, type MetaSet, type Visitors };
