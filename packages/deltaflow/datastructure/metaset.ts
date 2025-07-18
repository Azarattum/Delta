import { shared, type MetaSet, type Visitors } from "./metaset.types";
import { children, compare, either } from "./shape";

function traverse<T extends MetaSet>(visitors: Visitors<T>, ...sets: T[]): T {
  // TODO: consider length optimization
  if (sets.length === 1) return merge(sets[0], [[], []], visitors);
  if (sets.length === 2) return merge(sets[0], sets[1], visitors);
  const mid = Math.floor(sets.length / 2);

  const subVisitors = { combine: visitors.combine };

  return merge(
    traverse(subVisitors, ...sets.slice(0, mid)),
    traverse(subVisitors, ...sets.slice(mid)),
    visitors,
  );
}

// TODO: add types
function merge(target, source, visitors) {
  const shape = either(target[2], source[2]);
  const childKeys = children(shape);
  const { container, item, combine } = visitors;

  if (container) {
    target[0] = container(target[0], false);
    target[1] = container(target[1], !!childKeys.length) as (typeof target)[1];
    childKeys.forEach(([key, { shape }]) => {
      target[1][key] = container!(target[1][key], !!children(shape).length);
    });
  }

  const [sData, sMeta] = source;
  const [tData, tMeta] = target;

  const recurse = ([tMeta, sMeta], [tData, sData], [i, j], shape) =>
    merge([tData, tMeta[i], shape], [sData ?? [], sMeta?.[j] ?? []], visitors);

  const combineDeep = visitor(combine, recurse, [tMeta, sMeta], childKeys);
  const visit = visitor(item, recurse, [tMeta], childKeys);
  const insertDeep = inserter(tMeta, sMeta, childKeys);

  let i = 0;
  let j = 0;
  let deleted = 0;

  while (j < sData.length || i < tData.length) {
    const cmp =
      i < tData.length ?
        j < sData.length ?
          compare(tData[i], sData[j], shape)
        : -1
      : 1;

    let shouldDelete = false;

    if (cmp === 0) {
      const next = combineDeep([tData[i], sData[j]], [i, j]);
      if (next) [tData[i - deleted], tMeta[i - deleted]] = next;
      else shouldDelete = true;
    } else if (cmp > 0) {
      tData.splice(i, 0, sData[j]);
      tMeta.splice(i, 0, sMeta[j]);
      insertDeep(i, j);
    }

    if (!shouldDelete && visit) {
      const next = visit([tData[i]], [i]);
      if (next) [tData[i - deleted], tMeta[i - deleted]] = next;
      else shouldDelete = true;
    }

    if (shouldDelete) deleted++;

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
function visitor(fn, recurse, metas, childKeys) {
  return (items, idx, deleted = false) => {
    if (fn) {
      const next = fn(...items.flatMap((x, i) => [x, metas[i][idx[i]]]));
      if (next) [items[0], metas[0][idx[0]]] = next;
      else deleted = true;
    }

    childKeys.forEach(([key, { single, shape }]) => {
      if (!(idx[0] in metas[0][key])) return;
      const metas2 = metas.map((x) => x[key] ?? []);
      const items2 = items.map((x) => x[key] ?? []);

      const next =
        single ?
          visitor(fn, recurse, metas2, children(shape))(items2, idx, deleted)
        : recurse(metas2, items2, idx, shape);

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
function inserter(tMeta, sMeta, childKeys) {
  return (i, j) => {
    childKeys.forEach(([key, { single, shape }]) => {
      tMeta[key].splice(i, 0, sMeta[key][j]);
      if (single) inserter(tMeta[key], sMeta[key], children(shape))(i, j);
    });
  };
}

export { shared, traverse, type MetaSet, type Visitors };
