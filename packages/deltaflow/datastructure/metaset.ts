import type {
  InferItem,
  RecurseFn,
  Visitors,
  Recurse,
  MetaSet,
  Visit,
} from "./metaset.types";
import { children, compare, either } from "./shape";
import { shared } from "./metaset.types";

function traverse<T extends MetaSet>(fns: Visitors<T>, target: T, source?: T) {
  const shape = either(target[2], source?.[2]);
  const childKeys = children(shape);
  const deep = visit(fns, shape);

  const { container } = fns;
  if (container) {
    target[0] = container(target[0], false);
    target[1] = container(target[1], !!childKeys.length) as (typeof target)[1];
    childKeys.forEach(([key, { shape }]) => {
      target[1][key] = container(target[1][key], !!children(shape).length);
    });
  }

  const [tData, tMeta] = target;
  const [sData, sMeta] = source ?? ([[], []] as unknown as T);

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
    pruneMeta([tMeta], childKeys, deleted);
  }

  return target;
}

function visit<T extends MetaSet>(fns: Visitors<T>, shape: T[2]): Visit<T> {
  const childKeys = children(shape);
  return (type, items, metas, idx, deleted) => {
    const result: InferItem<T> | undefined =
      type === "delete" ? undefined
      : !fns[type] ? [items[0], metas[0][idx[0] - deleted]]
      : (fns[type] as any)(
          ...items.flatMap((x, i) => [x, metas[i][idx[i]]]),
          shape,
        );

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
      const [[tData, sData], [tMeta, sMeta]] = [items2, metas2];

      const next =
        single ?
          visit(fns2, shape)(type, items2, metas2, idx, deleted)
        : traverse<any>(fns2, [tData, tMeta, shape], sData && [sData, sMeta]);

      if (isInsert) resultMeta[key].splice(resultIdx, 0, tMeta[idx[0]]);
      if (next) [result![0][key], resultMeta[key][resultIdx]] = next;
      else {
        if (result) delete result[0][key];
        delete resultMeta[key][resultIdx];
      }
    });

    return result;
  };
}

function recurse<TFn extends RecurseFn>(fn: TFn): Recurse<TFn> {
  return function self(metas, childKeys, ...args) {
    childKeys.forEach(([key, { single, shape }]) => {
      fn(metas, key, ...args);
      if (single) {
        const metas2 = metas.map((x) => x[key]);
        self(metas2, children(shape), ...args);
      }
    });
  };
}

const pruneMeta = recurse(([meta], key, n: number) => (meta[key].length -= n));

export { shared, traverse, recurse, type MetaSet, type Visitors };
