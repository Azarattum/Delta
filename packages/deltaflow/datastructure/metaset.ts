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

  children(shape).forEach(([key, { single }]) => {
    if (single && visitors.collection) {
      meta[key] = visitors.collection([], meta[key])[1];
    }
    if (single && !visitors.item) return;

    data.forEach((x, i) => {
      if (single) {
        [x[key], meta[key][i]] = visitors.item!(x[key], meta[key][i]);
      } else {
        const next = traverse(visitors, subset(set, key, i));
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

function mergeInto<T extends MetaSet>(
  target: T,
  source: T,
  combine: Visitors<T>["combine"],
) {
  const [tData, tMeta, tShape] = target;
  const [sData, sMeta, sShape] = source;
  const shape = either(tShape, sShape);
  const childKeys = children(shape);

  let i = 0;
  let j = 0;

  while (j < sData.length) {
    const cmp = i < tData.length ? compare(tData[i], sData[j], shape) : 1;
    if (cmp === 0) {
      if (!combine) continue;
      [tData[i], tMeta[i]] = combine(tData[i], tMeta[i], sData[j], sMeta[j]);

      childKeys.forEach(([key, { single }]) => {
        const [a, b]: any[] = [subset(target, key, i), subset(source, key, j)];
        if (!single) mergeInto(a, b, combine);
        else [tData[i][key], tMeta[key][i]] = combine(a[0], a[1], b[0], b[1]);
      });

      i++, j++;
    } else if (cmp > 0) {
      tData.splice(i, 0, sData[j]);
      tMeta.splice(i, 0, sMeta[j]);

      childKeys.forEach(([key, { single }]) => {
        const metadata = sMeta[key]?.[j] ?? (single ? 0 : []);
        (tMeta[key] ??= []).splice(i, 0, metadata);
      });

      i++, j++;
    } else i++;
  }

  return target;
}

function subset<T extends MetaSet>(set: T, key: string, i: number): T {
  const shape = set[2]?.children?.[key].shape;
  return [(set[0][i][key] ??= []), (set[1][key] ??= [])[i], shape] as any;
}

export { shared, traverse, type MetaSet, type Visitors };
