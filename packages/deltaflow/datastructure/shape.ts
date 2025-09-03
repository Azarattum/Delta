function shape<T extends Template>(template: T): Shape<FromTemplate<T>> {
  const sample = template(defineFlags);

  const types = Object.values(sample) as number[];
  const keys = Object.keys(sample);
  const order = types
    .map((x, i) => (x & TYPE.PRIMARY ? i << 1 : null))
    .filter((x) => x !== null);
  const hash = checksum(types, order);

  return { keys, types, order, hash, children: {} } as any;
}

function reorder<TShape extends Shape<any> | undefined>(
  shape: TShape,
  ...ordering: TShape extends Shape<infer T> ?
    (NoInfer<keyof T> | [NoInfer<keyof T>, ("asc" | "desc")?])[]
  : []
): TShape {
  if (!shape) return shape;

  const primary = shape.types.map((x, i) => (x & TYPE.PRIMARY ? i << 1 : null));
  const order = ordering.map((entry) => {
    const [key, dir = "asc"] = Array.isArray(entry) ? entry : [entry];
    const index = shape.keys.indexOf(key);
    primary[index] = null;
    return (index << 1) | (dir === "desc" ? 1 : 0);
  });

  // Append unused primary keys to ensure uniqueness
  order.push(...primary.filter((x) => x !== null));

  const hash = checksum(shape.types, order);
  if (hash === shape.hash) return shape;
  return { ...shape, order, hash };
}

function nest<
  TShape extends Shape<any> | undefined,
  TChild extends Shape<any> | undefined,
  TRelation extends string,
  TSingle extends boolean = false,
>(
  shape: TShape,
  relation: TRelation,
  child: TChild,
  single = false as TSingle,
): undefined extends TShape | TChild ? TShape
: NestedShape<NonNullable<TShape>, NonNullable<TChild>, TRelation, TSingle> {
  if (!shape || !child) return shape as any;
  if (relation in shape.children) {
    const { shape: thisChild, single: thisSingle } = shape.children[relation];
    if (thisChild.hash === child.hash && thisSingle === single) return shape;
    const shapeString = JSON.stringify(shape, null, 2);
    throw new Error(`Relation ${relation} already exists on:\n${shapeString}`);
  }

  return {
    ...shape,
    children: { ...shape.children, [relation]: { single, shape: child } },
  };
}

function either<T>(aShape?: Shape<T>, bShape?: Shape<T>) {
  if (aShape && bShape && aShape.hash !== bShape.hash) {
    const aShapeString = JSON.stringify(aShape, null, 2);
    const bShapeString = JSON.stringify(bShape, null, 2);
    throw new Error(`Incompatible shapes:\n${aShapeString}\n${bShapeString}`);
  }
  return aShape ?? bShape;
}

function children<T>(shape: Shape<T> | undefined) {
  return Object.entries(shape?.children ?? {}) as Children<T>;
}

function compare<T>(a: T, b: T, shape?: Shape<T>) {
  for (let i = 0; i < (shape?.order.length ?? 1); i++) {
    const direction = shape && shape.order[i] & 1 ? -1 : 1;
    const key = shape?.keys[shape.order[i] >> 1];
    const x = key ? a[key] : a;
    const y = key ? b[key] : b;

    if (x === y) continue;
    if (y == null) return 1 * direction;
    if (x == null) return -1 * direction;

    if (typeof x !== typeof y) {
      throw new Error(`Mismatched types: ${typeof x} ${typeof y}`);
    }

    // TODO: ensure it is OK to use localeCompare
    if (typeof x === "string") return x.localeCompare(y as string) * direction;
    if (typeof x === "number") return (x - (y as number)) * direction;
    if (typeof x === "boolean") return (x ? 1 : -1) * direction;
    throw new Error(`Unsupported compare type: ${typeof x}`);
  }

  return 0;
}

function checksum(types: readonly number[], order: readonly number[]) {
  let hash = 0;
  types.forEach((x) => (hash = ((hash << 5) - hash + x) | 0));
  order.forEach((x) => (hash = ((hash << 5) - hash + x) | 0));
  return hash;
}

const RELATION = (id: number) => id << 16;

const TYPE = {
  INT: 0,
  DOUBLE: 1,
  STRING: 2,
  BOOLEAN: 3,
  BIGINT: 4,
  BYTES: 5,
  NULLABLE: 8,
  PRIMARY: 16,
  FTS: 32,
  ORDER: 64,
} as const;

const combineFlags = <T extends number[]>(...flags: T) =>
  flags.reduce((a, b) => a | b, 0) as ExtractConstNumbers<T>;

const defineFlags = Object.assign(combineFlags, TYPE, { RELATION });

type Shape<T = any> = Readonly<{
  "~type": T;
  hash: number;
  keys: readonly (keyof T)[];
  order: readonly number[];
  types: readonly (typeof TYPE)[keyof typeof TYPE][];
  children: Record<keyof T, { single: boolean; shape: Shape<T[keyof T]> }>;
}>;

type Template<T = unknown> = (
  t: typeof combineFlags & typeof TYPE & { RELATION: typeof RELATION },
) => {
  [K in keyof T]: (typeof TYPE)[keyof typeof TYPE];
};

type NestedShape<
  TShape extends Shape,
  TChild extends Shape,
  TRelation extends string,
  TSingle extends boolean,
> = Shape<
  (TShape & {})["~type"] & {
    [_ in TRelation]: TSingle extends true ? (TChild & {})["~type"]
    : (TChild & {})["~type"][];
  }
>;

type FromTemplate<T extends Template<unknown>> = {
  [K in keyof ReturnType<T>]:
    | ToPrimitive<ReturnType<T>[K]>
    | (typeof TYPE.NULLABLE extends ReturnType<T>[K] ? null : never);
} & {};

type ToPrimitive<T> =
  T extends typeof TYPE.INT ? number
  : T extends typeof TYPE.DOUBLE ? number
  : T extends typeof TYPE.STRING ? string
  : T extends typeof TYPE.BOOLEAN ? boolean
  : T extends typeof TYPE.BIGINT ? BigInt
  : T extends typeof TYPE.BYTES ? Uint8Array
  : never;

type ExtractConstNumbers<T extends any[]> = {
  [K in keyof T]: T[K] extends number ?
    number extends T[K] ?
      never
    : T[K]
  : never;
}[number];

type Children<T> = [string, NonNullable<Shape<T>["children"]>[keyof T]][];

export { TYPE, shape, children, compare, reorder, either, nest };
export type { Shape, Children };
