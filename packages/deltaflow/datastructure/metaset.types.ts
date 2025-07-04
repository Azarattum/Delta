import type { Shape } from "./shape";

const shared = Symbol("shared");

type Metadata<TData, TMeta, TShared = {}> = TMeta[] & {
  [K in ArrayKeys<TData>]: Metadata<
    TData[K] extends (infer T)[] ? T : never,
    TMeta,
    TShared
  >[];
} & {
  [K in RecordKeys<TData>]: Metadata<TData[K], TMeta, TShared>;
} & { [shared]?: TShared } & { [key: string]: any };

type MetaSet<TData = any, TMeta = any, TShared = {}> = [
  TData[],
  Metadata<TData, TMeta, TShared>,
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
  item?: (
    data: InferEntry<T>,
    meta: InferMeta<T>,
  ) => [InferEntry<T>, InferMeta<T>];
  collection?: (data: InferEntry<T>[], meta: T[1]) => [InferEntry<T>[], T[1]];
  combine?: (
    aData: InferEntry<T>,
    aMeta: InferMeta<T>,
    bData: InferEntry<T>,
    bMeta: InferMeta<T>,
  ) => [InferEntry<T>, InferMeta<T>];
};

export { shared };
export type {
  MetaSet,
  InferData,
  InferMeta,
  InferShared,
  InferEntry,
  Visitors,
};
