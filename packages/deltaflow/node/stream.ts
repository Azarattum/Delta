import {
  stream,
  type PartialEntities,
  type StreamOptions,
  type MaybePromise,
  type Stream,
} from "../stream";
import { add, type ZSet } from "../datastructure/zset";
import type { CLSet } from "../datastructure/clset";
import type { Order } from "../datastructure/shape";

const zStream = <
  TPush extends ZSet<any>,
  TPull extends MaybePromise<TPush> = MaybePromise<TPush>,
  TIn extends ZSet<any>[] = [Awaited<TPull>],
  TExtensions extends Record<string, unknown> = {},
  TThis = {},
>(
  options: StreamOptions<TPush, TPull, TIn, PullOptions, TExtensions> &
    TThis &
    ThisType<TThis>,
) =>
  stream({
    compress: (queue) => {
      return [
        queue.map((x) => x?.reduce((acc, x) => add(acc, x, false))),
      ] as PartialEntities<TIn>[];
    },
    ...options,
  });

type ZStream<T = any> = Stream<MaybePromise<ZSet<T>>, unknown[], PullOptions>;
type OfZStream<T extends Stream<any>> = T extends ZStream<infer U> ? U : never;

// TODO: CL specific stream implementation (compress CLSets)
const clStream = <
  TPush extends CLSet<any>,
  TPull extends MaybePromise<TPush> = MaybePromise<TPush>,
  TIn extends CLSet<any>[] = [Awaited<TPull>],
  TExtensions extends Record<string, unknown> = {},
  TThis = {},
>(
  options: StreamOptions<TPush, TPull, TIn, PullOptions, TExtensions> &
    TThis &
    ThisType<TThis>,
) => stream(options);

type CLStream<T = any> = Stream<MaybePromise<CLSet<T>>, unknown[], PullOptions>;
type OfCLStream<T extends Stream<any>> =
  T extends CLStream<infer U> ? U : never;

type PullOptions<T = Record<string, unknown>> = {
  /** Apply filtering based on the provided subset */
  filter?: {
    /** Keys to filter by (optionally reference keys if not the same) */
    keys: readonly [readonly string[], (readonly string[])?];
    /** Reference items to filter by */
    items: readonly T[];
    /** Whether to exclude the items instead of including them */
    exclude?: boolean;
  }[];
  /** Order to pull in */
  order?: Order<T>;
  /** Default weight to initialize data with */
  weight?: number;
  /** Cursor for precise pagination control */
  cursor?: {
    /** Anchoring element to start pagination from */
    anchor?: T;
    /** Whether to exclude the anchoring element itself */
    exclusive?: boolean;
    /** Non-negative offset from the anchor. If no anchor, from start/end (depends on count direction) */
    offset?: number;
    /** Number of elements to retrieve (positive for forward, negative for backward) */
    count?: number;
  };
  /** Mutable out-parameter for total row count (ignores cursor, respects filters) */
  total?: { out: number };
};

type ValidKey = number | string | Date | BufferSource;

export { zStream, clStream };
export type { ZStream, OfZStream, CLStream, OfCLStream, PullOptions, ValidKey };
