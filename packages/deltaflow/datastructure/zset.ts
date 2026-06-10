import { children, compare, isRelation, nest, nonPrimary } from "./shape";
import { len, recurse, traverse, type MetaSet } from "./metaset";
import type { Shape } from "./shape";

type ZSet<T> = MetaSet<T, number>;
type Identity = "order" | "relations";

function create(shape?: Shape, n = 1) {
  return (shape ? shape.mask : 0) + n;
}

function remove(shape?: Shape, n = 1) {
  return -(shape ? shape.mask : 0) - n;
}

function update<TShape extends Shape<Record<keyof any, unknown>>>(
  shape: TShape,
  ...keys: Exclude<keyof TShape["~type"], keyof TShape["~id"]>[]
) {
  if (!shape) return 0;
  if (!keys.length) return shape.mask;
  return keys.reduce((acc: number, key) => acc + bit(shape, key), 0);
}

function cardinality(meta: number, shape?: Shape) {
  const mask = shape ? shape.mask : 0;
  if (meta > mask) return meta - mask;
  if (-meta > mask) return meta + mask;
  return 0;
}

function changed<T>(meta: number, shape?: Shape<T>): number[];
function changed<T>(meta: number, shape: Shape<T>, key: keyof T): boolean;
function changed<T>(meta: number, shape?: Shape<T>, key?: keyof T) {
  if (!shape) return [];
  const mask = Math.min(Math.abs(meta), shape.mask);
  if (key) return Math.floor(mask / bit(shape, key)) % 2 === 1;

  const changes: number[] = [];
  if (!mask) return changes;

  for (let i = 0, value = 1; value <= mask; i++) {
    if (Math.floor(mask / value) % 2 === 1) changes.push(i);
    value *= 2;
  }

  return changes;
}

function combine(a: number, b: number, shape?: Shape) {
  const mask = shape ? shape.mask : 0;
  if (!mask) return a + b;

  const aCount = cardinality(a, shape);
  const bCount = cardinality(b, shape);
  const count = aCount + bCount;

  if (count) return Math.sign(count) * mask + count;
  if (aCount || bCount) return 0;

  if (a < 0x80000000 && b < 0x80000000) return a | b;
  const high = 0x1000000;
  const aLow = a % high;
  const bLow = b % high;
  const aHigh = (a - aLow) / high;
  const bHigh = (b - bLow) / high;
  return (aHigh | bHigh) * high + (aLow | bLow);
}

function bit<T>(shape: Shape<T>, key: keyof T) {
  const index = nonPrimary(shape).indexOf(key);
  return index === -1 ? 0 : 2 ** index;
}

function merge<T>(
  aData: T,
  aMeta: number,
  bData: T,
  bMeta: number,
  shape: Shape,
): [T, number] {
  if (bMeta > 0) {
    if (aData && typeof aData === "object" && bMeta < create(shape)) {
      nonPrimary(shape).forEach((key) => {
        if (!(key in (bData as Record<string, unknown>))) return;
        if (!changed(bMeta, shape, key)) return;
        aData[key as keyof T] = bData[key as keyof T];
      });
    } else {
      aData = bData;
    }
  }

  return [aData, combine(aMeta, bMeta, shape)];
}

function add<T>(
  a: ZSet<T>,
  b: ZSet<T>,
  { identity = "order" }: { identity?: Identity } = {},
) {
  if (!b[0].length) return a;

  return traverse(
    {
      combine: merge,
      compare:
        identity === "order" ? compare : (
          (aData, bData, shape) => {
            const cmp = compare(aData, bData, shape);
            if (cmp !== 0 || !shape) return cmp;
            return -shape.types.some((x, i) => {
              if (!isRelation(x)) return false;
              const key = shape.keys[i];
              return aData[key] !== bData[key];
            });
          }
        ),
    },
    a,
    b,
  );
}

function materialize<T>(set: ZSet<Partial<T>>, ref: T[]): ZSet<T> {
  const [data, meta, shape] = set;
  if (!shape) return set as ZSet<T>;
  const cmp = compare<Partial<T>>;

  const fields = nonPrimary(shape).map((key, i) => {
    const relation = isRelation(shape.types[shape.keys.indexOf(key)]);
    return [key, 2 ** i, relation] as const;
  });

  let written = 0;
  for (let i = 0, j = 0; i < len(set); i++) {
    let [item, weight] = [data[i], meta[i]];

    while (j < ref.length && cmp(ref[j], item, shape) < 0) j++;
    const old = cmp(ref[j], item, shape) ? undefined : ref[j];
    let exists = old !== undefined;

    for (let nextItem = item, nextWeight = weight; ; i++) {
      const count = cardinality(nextWeight, shape);

      if (count > 0 && !exists) {
        [item, weight, exists] = [nextItem, nextWeight, true];
      } else if (count < 0 && exists) {
        [weight, exists] = [nextWeight, false];
      } else if (count === 0 && exists) {
        [item, weight] = merge(item, weight, nextItem, nextWeight, shape);
      }

      if (i + 1 >= len(set) || cmp(item, data[i + 1], shape) !== 0) break;
      [nextItem, nextWeight] = [data[i + 1], meta[i + 1]];
    }

    if (!old && !exists) continue;
    if (!old || !exists) {
      data[written] = old ?? item;
      meta[written++] = old ? remove(shape) : create(shape);
      continue;
    }

    let relation = false;
    let mask = 0;

    fields.forEach(([key, bit, isRelation]) => {
      const unchanged = !(key in item) || !changed(weight, shape as any, key);
      if (unchanged) return (item[key] = old[key]);
      if (item[key] === old[key as keyof T]) return;
      (relation ||= isRelation), (mask += bit);
    });

    if (!mask) continue;
    if (relation) {
      data.splice(written, 0, old);
      meta.splice(written++, 0, remove(shape));
      i++; // The inserted remove sits before the unread tail, so skip over it.
    }

    data[written] = item;
    meta[written++] = relation ? create(shape) : mask;
  }

  data.length = written;
  meta.length = written;
  return set as ZSet<T>;
}

function multiply<A, B, K extends string, S extends boolean = false>(
  a: ZSet<A>,
  aKey: keyof A,
  b: ZSet<B>,
  bKey: keyof B,
  relationship: K,
  single = false as S,
) {
  const [aData, aMeta, aShape] = a;
  const [bData, bMeta, bShape] = b;
  const seen = new Map<A[keyof A] | B[keyof B], number>();
  const childKeys = children(bShape);

  (aMeta as any)[relationship] ??= [];

  if (single) {
    initMeta([aMeta[relationship]], childKeys);
    for (let i = 0; i < bData.length; i++) {
      const key = bData[i][bKey];
      if (!seen.has(key)) seen.set(key, i);
    }

    for (let i = 0; i < aData.length && bData.length; i++) {
      const id = seen.get(aData[i][aKey]);
      if (id === undefined) continue;
      (aData[i] as any)[relationship] = bData[id];
      (aMeta as any)[relationship][i] = bMeta[id];
      pushMeta([aMeta[relationship], bMeta], childKeys, id);
    }
  } else {
    for (let i = 0; i < aData.length; i++) {
      const key = aData[i][aKey];
      const cached = seen.get(key) ?? (seen.set(key, i), undefined);

      (aData[i] as any)[relationship] =
        cached === undefined ? [] : (aData[cached] as any)[relationship];
      (aMeta as any)[relationship][i] =
        cached === undefined ? [] : (aMeta as any)[relationship][cached];
      if (cached === undefined) initMeta([aMeta[relationship][i]], childKeys);
    }

    for (let i = 0; i < bData.length; i++) {
      const id = seen.get(bData[i][bKey]);
      if (id === undefined) continue;
      (aData[id] as any)[relationship].push(bData[i]);
      (aMeta as any)[relationship][id].push(bMeta[i]);
      pushMeta([aMeta[relationship][id], bMeta], childKeys, i);
    }
  }

  (a as MetaSet)[2] = nest(aShape, relationship, bShape, single);
  return a as ZSet<
    Omit<A, K> & (S extends true ? { [_ in K]?: B } : { [_ in K]: B[] })
  >;
}

function distinct<T>(item: ZSet<T>) {
  return traverse(
    {
      update: (data, meta, shape) =>
        cardinality(meta, shape) > 0 ? [data, create(shape)] : undefined,
    },
    item,
  );
}

function zero<T>(item?: ZSet<T>) {
  if (!item) return [[], []] as ZSet<T>;
  return traverse({ update: (data) => [data, 0] }, item);
}

function copy<T>(item: ZSet<T>) {
  return traverse(
    {
      update: (data, meta) => [{ ...data }, meta],
      container: (container, deep): any =>
        deep ? Object.assign([], container) : container.slice(),
    },
    [...item],
  );
}

function sort<T>(item: ZSet<T>, compare: (a: T, b: T) => number) {
  item[0]
    .map((x, i) => [x, item[1][i]] as const)
    .sort((x, y) => compare(x[0], y[0]))
    .forEach((x, i) => {
      item[0][i] = x[0];
      item[1][i] = x[1];
    });

  return item;
}

function cut<T, P extends number[]>(item: ZSet<T>, ...positions: P) {
  let offset = 0;
  const items = positions.map((position) => {
    const at = position - offset;
    offset += at;

    const data2 = item[0].splice(at);
    const meta2 = item[1].splice(at);
    cutMeta([item[1], meta2 as any], children(item[2]), at);

    try {
      return item;
    } finally {
      item = [data2, meta2, item[2]] as ZSet<T>;
    }
  });
  items.push(item);

  type CutResult<P extends number[]> =
    P extends [number, ...infer Rest extends number[]] ?
      [ZSet<T>, ...CutResult<Rest>]
    : [ZSet<T>];

  return items as CutResult<P>;
}

function transform<T, U>(
  item: ZSet<T>,
  fn: (data: T, meta: number, shape: Shape) => [U, number] | undefined | false,
) {
  return traverse({ shallow: true, update: fn as any }, item) as any as ZSet<U>;
}

const initMeta = recurse(([meta], key) => (meta[key] ??= []));
const pushMeta = recurse(([aMeta, bMeta], key, i: number) =>
  aMeta[key].push(bMeta[key][i]),
);
const cutMeta = recurse(([meta1, meta2], key, at: number) => {
  meta2[key] = meta1[key].splice(at);
});

export {
  cardinality,
  materialize,
  transform,
  multiply,
  distinct,
  changed,
  combine,
  create,
  remove,
  update,
  sort,
  zero,
  copy,
  add,
  cut,
};
export type { ZSet };
