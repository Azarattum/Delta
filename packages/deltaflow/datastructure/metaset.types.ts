import type { Shape } from "./shape";

const shared = Symbol("shared");

type Meta<TData, TMeta, TShared = undefined> = TMeta[] & {
  [K in ArrayKeys<TData>]: Meta<
    TData[K] extends (infer T)[] ? T : never,
    TMeta,
    TShared
  >[];
} & {
  [K in RecordKeys<TData>]: Meta<TData[K], TMeta, TShared>;
} & { [key: string]: any } & (TShared extends undefined ? {}
  : { [shared]: TShared });

type MetaSet<TData = any, TMeta = any, TShared = undefined> = [
  TData[],
  Meta<TData, TMeta, TShared>,
  Shape<TData>?,
];

type InferData<T> = T extends MetaSet<infer TData, any, any> ? TData : never;
type InferMeta<T> = T extends MetaSet<any, infer TMeta, any> ? TMeta : never;
type InferShared<T> =
  T extends MetaSet<any, any, infer TShared> ? TShared : never;
type InferEntry<T> =
  T extends MetaSet<infer TData, any, any> ?
    TData extends object ?
      TraverseEntries<TData>
    : TData
  : never;
type InferItem<T extends MetaSet> = [InferData<T>, InferMeta<T>];

type TraverseEntries<T> =
  T extends (infer U)[] ? TraverseEntries<U>
  : T extends object ? T | { [K in keyof T]: TraverseEntries<T[K]> }[keyof T]
  : never;

type ArrayKeys<T> =
  T extends Record<keyof any, any> ?
    {
      [K in keyof T]: T[K] extends any[] ? K : never;
    }[keyof T]
  : never;

type RecordKeys<T> =
  T extends Record<keyof any, any> ?
    {
      [K in keyof T]: T[K] extends any[] ? never
      : T[K] extends Record<keyof any, any> ? K
      : never;
    }[keyof T]
  : never;

type Visitors<T extends MetaSet> = {
  update?: (
    data: InferEntry<T>,
    meta: InferMeta<T>,
  ) => [InferEntry<T>, InferMeta<T>] | undefined;
  insert?: (
    data: InferEntry<T>,
    meta: InferMeta<T>,
  ) => [InferEntry<T>, InferMeta<T>] | undefined;
  combine?: (
    aData: InferEntry<T>,
    aMeta: InferMeta<T>,
    bData: InferEntry<T>,
    bMeta: InferMeta<T>,
  ) => [InferEntry<T>, InferMeta<T>] | undefined;

  container?: <TDeep extends boolean>(
    container: TDeep extends true ? Record<string, unknown> & unknown[]
    : unknown[],
    deep: TDeep,
  ) => TDeep extends true ? Record<string, unknown> & unknown[] : unknown[];
};

type Recurse = <T extends MetaSet>(
  items: T[0][],
  metas: T[1][],
  shape: Shape<InferData<T>>,
  fns: Visitors<T>,
) => T;

type Visit<T extends MetaSet> = (
  type: Exclude<keyof Visitors<T>, "container"> | "delete",
  items: T[0],
  metas: T[1][],
  idx: number[],
  del: number,
) => InferItem<T> | undefined;

export { shared };
export type {
  MetaSet,
  InferData,
  InferMeta,
  InferItem,
  InferShared,
  InferEntry,
  Visitors,
  Recurse,
  Visit,
};
