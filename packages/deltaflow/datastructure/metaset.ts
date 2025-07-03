import type { MetaSet, Visitors } from "./metaset.types";
import { children, compare, either } from "./shape";

function traverse<T extends MetaSet>(visitors: Visitors<T>, ...sets: T[]): T {
  let [data, meta, shape] = merge(visitors.combine, ...sets);
  if (!visitors.item && !visitors.collection) return sets[0];

  if (visitors.collection) {
    [data, meta] = visitors.collection(data, meta);
    sets[0] = [data, meta, shape] as any;
  }

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
        const y = traverse(visitors, subset(sets[0], key, i));
        if (visitors.collection) [x[key], meta[key][i]] = y;
      }
    });
  });

  return sets[0];
}

function merge<T extends MetaSet>(
  combine: Visitors<T>["combine"],
  ...items: T[]
): T {
  // TODO: consider length optimization
  if (items.length === 1) return items[0];
  if (items.length === 2) return mergeInto(items[0], items[1], combine);
  const mid = Math.floor(items.length / 2);

  return mergeInto(
    merge(combine, ...items.slice(0, mid)),
    merge(combine, ...items.slice(mid)),
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

export { traverse, type MetaSet };
