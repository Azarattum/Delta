import {
  stream,
  type StreamExtensions,
  type PartialEntities,
  type StreamOptions,
  type MaybePromise,
  type DefaultPull,
  type ActualPull,
  type Stream,
} from "../stream";
import { add, type ZSet } from "../datastructure/zset";
import type { CLSet } from "../datastructure/clset";
import type { Order } from "../datastructure/shape";
import type { Query } from "./source/source";

const zStream = <
  TPush extends MaybePromise<ZSet<any>>,
  TPull extends DefaultPull<NoInfer<TPush>> = DefaultPull<TPush>,
  TIn extends ZSet<any>[] = [Awaited<ActualPull<TPull>>],
  TExtensions extends StreamExtensions = {},
  TThis = {},
>(
  options: StreamOptions<TPush, TPull, TIn, ZPullOptions, TExtensions> &
    TThis &
    ThisType<TThis>,
) =>
  stream({
    compress: (queue) => {
      const opts = { identity: "relations" as const };
      return [
        queue.map((x) => x?.reduce((acc, x) => add(acc, x, opts))),
      ] as PartialEntities<TIn>[];
    },
    ...options,
  });

type ZStream<T = any> = Stream<MaybePromise<ZSet<T>>, unknown[], ZPullOptions>;
type OfZStream<T extends Stream<any>> = T extends ZStream<infer U> ? U : never;

// TODO: CL specific stream implementation (compress CLSets)
const clStream = <
  TPush extends MaybePromise<CLSet<any>>,
  TPull extends DefaultPull<NoInfer<TPush>> = DefaultPull<TPush>,
  TIn extends CLSet<any>[] = [Awaited<ActualPull<TPull>>],
  TExtensions extends StreamExtensions = {},
  TThis = {},
>(
  options: StreamOptions<TPush, TPull, TIn, CLPullOptions, TExtensions> &
    TThis &
    ThisType<TThis>,
) => stream(options);

type CLStream<T = any> = Stream<
  MaybePromise<CLSet<T>>,
  unknown[],
  CLPullOptions
>;
type OfCLStream<T extends CLStream<any>> =
  T extends CLStream<infer U> ? U : never;

type ZPullOptions<T extends Record<string, unknown> = Record<string, unknown>> =
  Omit<Query<T>, "order"> & {
    /** Order to pull in. By default sorts by primary key */
    order?: Order<T>;
    /** Logical row cardinality to initialize data with */
    cardinality?: number;
  };

type CLPullOptions = { version: number };

type ValidKey = number | string | Date | BufferSource;

export { zStream, clStream };
export type {
  ZStream,
  CLStream,
  ValidKey,
  OfZStream,
  OfCLStream,
  ZPullOptions,
  CLPullOptions,
};
