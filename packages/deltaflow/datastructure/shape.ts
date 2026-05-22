function shape<T extends Template>(template: T): Shape<FromTemplate<T>, ID<T>> {
  const sample = template(defineFlags);

  const types = Object.values(sample) as number[];
  const keys = Object.keys(sample);
  const order = types
    .map((x, i) => (x & TYPE.PRIMARY ? i << 1 : null))
    .filter((x) => x !== null);
  const hash = checksum(types, order);
  const fields = nonPrimary({ keys, types }).length;
  if (fields > 50) throw new Error(`Too many non-primary fields: ${fields}`);
  const mask = 2 ** fields - 1;

  return { keys, types, order, hash, mask, children: {} } as any;
}

function reorder<TShape extends Shape<T> | undefined, T = any>(
  shape: TShape,
  ...order: Order<T>
): TShape {
  if (!shape) return shape;

  const primary = shape.types.map((x, i) => (x & TYPE.PRIMARY ? i << 1 : null));
  const encoded = order.map((entry) => {
    const [key, dir = "asc"] = Array.isArray(entry) ? entry : [entry];
    const index = shape.keys.indexOf(key as keyof T);
    primary[index] = null;
    return (index << 1) | (dir === "desc" ? 1 : 0);
  });

  // Append unused primary keys to ensure uniqueness
  encoded.push(...primary.filter((x) => x !== null));

  const hash = checksum(shape.types, encoded);
  if (hash === shape.hash) return shape;
  return { ...shape, order: encoded, hash };
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
    if (thisChild?.hash === child.hash && thisSingle === single) {
      return shape as any;
    }
    const shapeString = JSON.stringify(shape, null, 2);
    throw new Error(`Relation ${relation} already exists on:\n${shapeString}`);
  }

  // TODO: handle when child replaces a field (recompute keys, types, hash, mask etc.)
  const children = { ...shape.children, [relation]: { single, shape: child } };
  return { ...(shape as any), children };
}

function either<T>(aShape?: Shape<T>, bShape?: Shape<T>) {
  if (aShape && bShape && aShape.hash !== bShape.hash) {
    const aShapeString = JSON.stringify(aShape, null, 2);
    const bShapeString = JSON.stringify(bShape, null, 2);
    throw new Error(`Incompatible shapes:\n${aShapeString}\n${bShapeString}`);
  }
  return aShape ?? bShape;
}

function children<T extends Shape>(shape: T) {
  return Object.entries(shape?.children ?? {}) as Children<T>;
}

function primary<K extends keyof any>(shape?: ShapeLike<K>): K[] {
  return shape?.keys.filter((_, i) => shape.types[i] & TYPE.PRIMARY) ?? [];
}

function nonPrimary<K extends keyof any>(shape?: ShapeLike<K>): K[] {
  return shape?.keys.filter((_, i) => !(shape.types[i] & TYPE.PRIMARY)) ?? [];
}

function compare<T>(a: T, b: T, shape?: Shape<T>) {
  for (let i = 0; i < (shape?.order.length ?? 1); i++) {
    const direction = shape && shape.order[i] & 1 ? -1 : 1;
    const key = shape?.keys[shape.order[i] >> 1];
    const x = key ? a?.[key] : a;
    const y = key ? b?.[key] : b;

    if (x === y) continue;
    if (y == null) return 1 * direction;
    if (x == null) return -1 * direction;

    const type = typeof x;
    if (type !== typeof y || type === "object" || type === "function") {
      throw new Error(`Unsupported compare types: ${type} ${typeof y}`);
    }

    return (x < y ? -1 : 1) * direction;
  }

  return 0;
}

function checksum(types: readonly number[], order: readonly number[]) {
  let hash = 0;
  types.forEach((x) => (hash = ((hash << 5) - hash + x) | 0));
  order.forEach((x) => (hash = ((hash << 5) - hash + x) | 0));
  return hash;
}

function datatype(type: number) {
  return (type & 0b111) as
    | typeof TYPE.INT
    | typeof TYPE.DOUBLE
    | typeof TYPE.STRING
    | typeof TYPE.BOOLEAN
    | typeof TYPE.BIGINT
    | typeof TYPE.BYTES;
}

function isPrimary(type: number) {
  return (type & TYPE.PRIMARY) !== 0;
}

function isNullable(type: number) {
  return (type & TYPE.NULLABLE) !== 0;
}

function isRelation(type: number) {
  return (type & TYPE.RELATION) !== 0;
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
  RELATION: 2147418112, // 2**31 - 2**16
} as const;

const combineFlags = <T extends number[]>(...flags: T) =>
  flags.reduce((a, b) => a | b, 0) as ExtractConstNumbers<T>;

const defineFlags = Object.assign(combineFlags, TYPE, { RELATION });

type Shape<T = any, TId = {}> =
  T extends object ?
    Readonly<{
      "~type": T;
      "~id": TId;
      hash: number;
      mask: number;
      keys: readonly (keyof T)[];
      order: readonly number[];
      types: readonly number[];
      children: 0 extends 1 & T ?
        Record<keyof T, { single: boolean; shape: Shape<T[keyof T]> }>
      : {
          [K in keyof T as T[K] extends object ? K : never]: T[K] extends (
            (infer U)[]
          ) ?
            { single: false; shape: Shape<U> }
          : { single: true; shape: Shape<T[K]> };
        };
    }>
  : undefined;

type ShapeLike<K extends keyof any> = Readonly<{
  keys: readonly K[];
  types: readonly number[];
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
  [K in keyof ReturnType<T>]: ToPrimitive<ReturnType<T>[K]>;
} & {};

type ID<T extends Template<unknown>> = {
  [K in keyof ReturnType<T> as typeof TYPE.PRIMARY extends ReturnType<T>[K] ? K
  : never]: ToPrimitive<ReturnType<T>[K]>;
} & {};

type ToPrimitive<T> =
  | (T extends typeof TYPE.INT ? number
    : T extends typeof TYPE.DOUBLE ? number
    : T extends typeof TYPE.STRING ? string
    : T extends typeof TYPE.BOOLEAN ? boolean
    : T extends typeof TYPE.BIGINT ? BigInt
    : T extends typeof TYPE.BYTES ? Uint8Array
    : never)
  | (typeof TYPE.NULLABLE extends T ? null : never);

type ExtractConstNumbers<T extends any[]> = {
  [K in keyof T]: T[K] extends number ?
    number extends T[K] ?
      never
    : T[K]
  : never;
}[number];

type Children<T extends Shape> = [
  string,
  NonNullable<T>["children"][keyof NonNullable<T>["children"]],
][];

type Order<T> = (
  | NoInfer<keyof T & string>
  | readonly [NoInfer<keyof T & string>, ("asc" | "desc")?]
)[];

export {
  nonPrimary,
  isNullable,
  isRelation,
  isPrimary,
  datatype,
  children,
  primary,
  compare,
  reorder,
  either,
  shape,
  nest,
};
export type { Shape, Children, Order };
