import { shared, type MetaSet, type Visitors } from "./metaset.types";
import { children, compare, either } from "./shape";

function traverse<T extends MetaSet>(visitors: Visitors<T>, ...sets: T[]): T {
  // TODO: consider length optimization
  if (sets.length === 1) return merge(visitors, sets[0]);
  if (sets.length === 2) return merge(visitors, sets[0], sets[1]);

  const mid = Math.floor(sets.length / 2);
  return merge(
    visitors,
    traverse({ combine: visitors.combine }, ...sets.slice(0, mid)),
    traverse({ combine: visitors.combine }, ...sets.slice(mid)),
  );
}

// TODO: add types
function merge(visitors, target, source?) {
  const { container, each, combine } = visitors;
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

  const recurse = ([tMeta, sMeta], [tData, sData], [i, j], shape) =>
    merge(visitors, [tData, tMeta[i], shape], [sData ?? [], sMeta?.[j] ?? []]);

  const combineDeep = visitor(recurse, combine, childKeys, tMeta, sMeta);
  const eachDeep = visitor(recurse, each, childKeys, tMeta);
  const insertDeep = inserter(childKeys, tMeta, sMeta);

  let deleted = 0;
  let i = 0;
  let j = 0;

  while (j < sData.length || i < tData.length) {
    const cmp =
      -(j >= sData.length) ||
      +(i >= tData.length) ||
      compare(tData[i], sData[j], shape);

    const ti = i - deleted;

    if (cmp === 0 && combine) {
      [tData[i], tMeta[i]] = combineDeep([tData[i], sData[j]], [i, j])!;
    } else if (cmp > 0) {
      tData.splice(i, 0, sData[j]);
      tMeta.splice(i, 0, sMeta[j]);
      insertDeep(i, j);
    }

    const next = eachDeep([tData[i]], [i]);
    if (next) [tData[ti], tMeta[ti]] = next;
    else deleted++;

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
function visitor(recurse, fn, childKeys, ...metas) {
  return (items, idx, deleted = false) => {
    if (fn) {
      const next = fn(...items.flatMap((x, i) => [x, metas[i][idx[i]]]));
      if (next) [items[0], metas[0][idx[0]]] = next;
      else deleted = true;
    }

    childKeys.forEach(([key, { single, shape }]) => {
      if (!(idx[0] in metas[0][key])) return;
      const metas2 = metas.map((x) => x[key]);
      const items2 = items.map((x) => x[key]);

      const next =
        single ?
          visitor(recurse, fn, children(shape), ...metas2)(items2, idx, deleted)
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
function inserter(childKeys, tMeta, sMeta) {
  return (i, j) => {
    childKeys.forEach(([key, { single, shape }]) => {
      tMeta[key].splice(i, 0, sMeta[key][j]);
      if (single) inserter(children(shape), tMeta[key], sMeta[key])(i, j);
    });
  };
}

export { shared, traverse, type MetaSet, type Visitors };
