function shape<T extends Template>(template: T): Shape<FromTemplate<T>> {
  const sample = template(defineFlags);

  const types = Object.values(sample) as number[];
  const keys = Object.keys(sample);
  const order = types
    .map((x, i) => (x & TYPE.PRIMARY ? i << 1 : null))
    .filter((x) => x !== null);

  return { keys, types, order } as any;
}

function reorder<T>(
  shape: Shape<T>,
  ...ordering: (NoInfer<keyof T> | [NoInfer<keyof T>, ("asc" | "desc")?])[]
) {
  const order = ordering.map((entry) => {
    const [key, dir = "asc"] = Array.isArray(entry) ? entry : [entry];
    return (shape.keys.indexOf(key as keyof T) << 1) | (dir === "desc" ? 1 : 0);
  });

  return { ...shape, order };
}

function nest<
  TShape extends Shape<any> | undefined,
  TChild extends Shape<any> | undefined,
  TRelation extends string,
>(
  shape: TShape,
  relation: TRelation,
  child: TChild,
): undefined extends TShape | TChild ? undefined
: NestedShape<NonNullable<TShape>, NonNullable<TChild>, TRelation> {
  if (!shape || !child) return shape as any;
  return {
    ...shape,
    children: { ...shape.children, [relation]: child },
  } as any;
}

function either<T>(aShape?: Shape<T>, bShape?: Shape<T>) {
  if (aShape && bShape && aShape.order.toString() !== bShape.order.toString()) {
    const aShapeString = JSON.stringify(aShape, null, 2);
    const bShapeString = JSON.stringify(bShape, null, 2);
    throw new Error(`Incompatible shapes:\n${aShapeString}\n${bShapeString}`);
  }
  return aShape ?? bShape;
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
  keys: readonly (keyof T)[];
  order: readonly number[];
  types: readonly (typeof TYPE)[keyof typeof TYPE][];
  children?: Record<keyof T, Shape<T[keyof T]> | undefined>;
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
> = Shape<
  (TShape & {})["~type"] & { [_ in TRelation]: (TChild & {})["~type"][] }
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

export { TYPE, shape, reorder, either, nest };
export type { Shape };
