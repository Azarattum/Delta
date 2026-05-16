import type { Children, Shape } from "./shape";

type Meta<TData, TMeta> = TMeta[] & {
  [K in ArrayKeys<TData>]: Meta<
    TData[K] extends (infer T)[] ? T : never,
    TMeta
  >[];
} & { [K in RecordKeys<TData>]: Meta<TData[K], TMeta> } & {
  [key: string]: any;
};

type MetaSet<TData = any, TMeta = any> = [
  TData[],
  Meta<TData, TMeta>,
  Shape<TData>?,
];

type InferData<T> = T extends MetaSet<infer TData, any> ? TData : never;
type InferMeta<T> = T extends MetaSet<any, infer TMeta> ? TMeta : never;
type InferEntry<T> =
  T extends MetaSet<infer TData, any> ?
    TData extends object ?
      TraverseEntries<TData>
    : TData
  : never;
type InferItem<T extends MetaSet> = [InferData<T>, InferMeta<T>];

type TraverseEntries<T> =
  T extends (infer U)[] ? TraverseEntries<U>
  : T extends object ? T | { [K in keyof T]: TraverseEntries<T[K]> }[keyof T]
  : never;

type ChildShape<T> =
  T extends { children: infer TChildren } ?
    [keyof TChildren] extends [never] ? never
    : TChildren[keyof TChildren] extends { shape: infer TShape extends Shape } ?
      TShape
    : never
  : never;

type TraverseChildShape<TShape extends Shape> =
  TShape extends Shape ?
    0 extends 1 & NonNullable<TShape>["~type"] ?
      TShape
    : TraverseShape<TShape>
  : never;

type TraverseShape<T> = T | TraverseChildShape<ChildShape<T>>;

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

type GenericVisitors<
  TData,
  TMeta extends Meta<TData, any>,
  TShape extends Shape,
  TShallow extends boolean,
> = {
  update?: (
    data: TData,
    meta: TMeta,
    shape: TShape,
  ) => [TData, TMeta] | undefined;
  insert?: (
    data: TData,
    meta: TMeta,
    shape: TShape,
  ) => [TData, TMeta] | undefined;
  combine?: (
    aData: TData,
    aMeta: TMeta,
    bData: TData,
    bMeta: TMeta,
    shape: TShape,
  ) => [TData, TMeta] | undefined;

  container?: <TDeep extends boolean>(
    container: TDeep extends true ? Record<string, unknown> & unknown[]
    : unknown[],
    deep: TDeep,
  ) => TDeep extends true ? Record<string, unknown> & unknown[] : unknown[];

  compare?: <T>(a: T, b: T, shape?: Shape<T>) => number;
} & (TShallow extends true ? { shallow: true } : { shallow?: false });

type Visitors<T extends MetaSet> =
  | GenericVisitors<InferData<T>, InferMeta<T>, T[2], true>
  | GenericVisitors<InferEntry<T>, InferMeta<T>, TraverseShape<T[2]>, false>;

type Visit<T extends MetaSet> = (
  type: Exclude<keyof Visitors<T>, "container"> | "delete",
  items: T[0],
  metas: T[1][],
  idx: number[],
  del: number,
) => InferItem<T> | undefined;

type RecurseFn = (metas: Meta<any, any>[], key: string, ...args: any[]) => void;

type Recurse<TFn extends RecurseFn> = (
  metas: Meta<any, any>[],
  childKeys: Children<any>,
  ...args: Parameters<TFn> extends [any, any, ...infer Rest] ? Rest : never
) => void;

export type {
  MetaSet,
  InferData,
  InferMeta,
  InferItem,
  InferEntry,
  Visitors,
  Visit,
  RecurseFn,
  Recurse,
};
