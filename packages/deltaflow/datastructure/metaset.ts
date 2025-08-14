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
    else if (cmp <= 0) {
      // TODO: the responsibility separation is a little confusing here
      tData[ti] = next[0];
    } else {
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
    if (fns[type]) {
      const next = fns[type](...items.flatMap((x, i) => [x, metas[i][idx[i]]]));
      // TODO: insert modifies the source?.. meh...
      if (next) [items[0], metas[0][idx[0] - del]] = next;
      else type = "delete";
    }

    childKeys.forEach(([key, { single, shape }]) => {
      if (!(idx[0] in metas[0][key])) return;
      const items2 = items.map((x) => x[key]);
      const metas2 = metas.map((x) => x[key]);
      const fns2 = type === "insert" ? { ...fns, update: fns.insert } : fns;

      const next =
        single ?
          visitor(recurse, children(shape), fns)(type, items2, metas2, idx, del)
        : type !== "delete" && recurse(items2, metas2, idx, shape, fns2);

      if (type === "insert") {
        metas2[1].splice(idx[1] - del, 0, metas2[0][idx[0]]);
      }
      if (type !== "delete") {
        if (next) [items[0][key], metas[0][key][idx[0] - del]] = next;
        else {
          delete items[0][key];
          delete metas[0][key][idx[0] - del];
        }
      }
    });

    return type === "delete" ? undefined : [items[0], metas[0][idx[0] - del]];
  };
}

export { shared, traverse, type MetaSet, type Visitors };
