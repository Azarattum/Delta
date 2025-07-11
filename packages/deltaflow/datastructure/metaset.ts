import { shared, type MetaSet, type Visitors } from "./metaset.types";
import { children, compare, either } from "./shape";

function traverse<T extends MetaSet>(visitors: Visitors<T>, ...sets: T[]): T {
  const set = merge(visitors.combine, ...sets);
  if (!visitors.item && !visitors.collection) return set;

  if (visitors.collection) {
    [set[0], set[1]] = visitors.collection(set[0], set[1]);
  }

  const [data, meta, shape] = set;

  if (visitors.item) {
    data.forEach((x, i) => {
      [data[i], meta[i]] = visitors.item!(x, meta[i]);
    });
  }

  children(shape).forEach(([key, { single, shape }]) => {
    if (single && visitors.collection) {
      meta[key] = visitors.collection([], meta[key])[1];
    }
    if (single && !visitors.item) return;

    data.forEach((x, i) => {
      if (single) {
        [x[key], meta[key][i]] = visitors.item!(x[key], meta[key][i]);
      } else {
        const subset: any = [data[i][key], meta[key][i], shape];
        const next = traverse(visitors, subset);
        if (visitors.collection) [x[key], meta[key][i]] = next;
      }
    });
  });

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

  const combineDeep = combine && combiner(tMeta, sMeta, childKeys, combine);
  const insertDeep = inserter(tMeta, sMeta, childKeys);

  let i = 0;
  let j = 0;

  while (j < sData.length) {
    const cmp = i < tData.length ? compare(tData[i], sData[j], shape) : 1;
    if (cmp === 0) {
      if (!combine) continue;
      [tData[i], tMeta[i]] = combineDeep(tData[i], sData[j], i, j);

      i++, j++;
    } else if (cmp > 0) {
      tData.splice(i, 0, sData[j]);
      tMeta.splice(i, 0, sMeta[j]);
      insertDeep(i, j);

      i++, j++;
    } else i++;
  }

  return target;
}

// TODO: add types
function combiner(tMeta, sMeta, childKeys, combine) {
  return (tItem, sItem, i, j) => {
    [tItem, tMeta[i]] = combine(tItem, tMeta[i], sItem, sMeta[j]);

    childKeys.forEach(([key, { single, shape }]) => {
      if (single) {
        const childKeys = children(shape);
        const merger = combiner(tMeta[key], sMeta[key], childKeys, combine);
        [tItem[key], tMeta[key][i]] = merger(tItem[key], sItem[key], i, j);
      } else if (key in sItem) {
        const tSubset = [tItem[key], tMeta[key][i], shape];
        const sSubset = [sItem[key], sMeta[key][j], shape];
        mergeInto(tSubset, sSubset, combine);
      }
    });

    return [tItem, tMeta[i]];
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
