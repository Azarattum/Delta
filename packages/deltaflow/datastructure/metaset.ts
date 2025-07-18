import { shared, type MetaSet, type Visitors } from "./metaset.types";
import { children, compare, either } from "./shape";

function traverse<T extends MetaSet>(visitors: Visitors<T>, ...sets: T[]): T {
  const set = merge(visitors.combine, ...sets);
  if (!visitors.item && !visitors.container) return set;

  const childKeys = children(set[2]);

  if (visitors.container) {
    set[0] = visitors.container(set[0], false);
    set[1] = visitors.container(set[1], !!childKeys.length) as (typeof set)[1];
    childKeys.forEach(([key, { shape }]) => {
      set[1][key] = visitors.container!(set[1][key], !!children(shape).length);
    });
  }

  let deleted = 0;
  const visit = visitor(
    visitors.item,
    ([meta], [item], [i], shape) =>
      traverse(visitors, [item, meta[i], shape] as any),
    [set[1]],
    childKeys,
  );
  set[0].forEach((x, i) => {
    const next = visit([x], [i]);
    if (next) [set[0][i - deleted], set[1][i - deleted]] = next;
    else deleted++;
  });

  if (deleted) {
    set[0].length -= deleted;
    set[1].length -= deleted;
  }

  return set;
}

function merge<T extends MetaSet>(
  combine: Visitors<T>["combine"],
  ...sets: T[]
): T {
  // TODO: consider length optimization
  if (sets.length === 1) return sets[0];
  if (sets.length === 2) return mergeInto(sets[0], sets[1], combine);
  const mid = Math.floor(sets.length / 2);

  return mergeInto(
    merge(combine, ...sets.slice(0, mid)),
    merge(combine, ...sets.slice(mid)),
    combine,
  );
}

// TODO: add types
function mergeInto(target, source, combine) {
  const [tData, tMeta, tShape] = target;
  const [sData, sMeta, sShape] = source;
  const shape = either(tShape, sShape);
  const childKeys = children(shape);

  const combineDeep = visitor(
    combine,
    ([tMeta, sMeta], [tItem, sItem], [i, j], shape) =>
      mergeInto([tItem, tMeta[i], shape], [sItem, sMeta[j], shape], combine),
    [tMeta, sMeta],
    childKeys,
  );
  const insertDeep = inserter(tMeta, sMeta, childKeys);

  let i = 0;
  let j = 0;
  let deleted = 0;

  while (j < sData.length) {
    const cmp = i < tData.length ? compare(tData[i], sData[j], shape) : 1;
    if (cmp === 0) {
      const next = combineDeep([tData[i], sData[j]], [i, j]);
      if (next) [tData[i - deleted], tMeta[i - deleted]] = next;
      else deleted++;

      i++, j++;
    } else if (cmp > 0) {
      tData.splice(i, 0, sData[j]);
      tMeta.splice(i, 0, sMeta[j]);
      insertDeep(i, j);

      i++, j++;
    } else i++;
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
