import {
  stream,
  type PartialEntities,
  type StreamOptions,
  type MaybePromise,
  type Stream,
} from "../stream";
import { add, type ZSet } from "../datastructure/zset";
import type { CLSet } from "../datastructure/clset";

const zStream = <
  TPush extends ZSet<any>,
  TPull extends MaybePromise<TPush> = MaybePromise<TPush>,
  TIn extends ZSet<any>[] = [Awaited<TPull>],
>(
  options: StreamOptions<TPush, TPull, TIn, PullOptions>,
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
>(
  options: StreamOptions<TPush, TPull, TIn, PullOptions>,
) => stream(options);

type CLStream<T = any> = Stream<MaybePromise<CLSet<T>>, unknown[], PullOptions>;
type OfCLStream<T extends Stream<any>> =
  T extends CLStream<infer U> ? U : never;

type PullOptions = {
  /** Lookup and order by provided keys */
  constraints?: Record<keyof any, Set<ValidKey>>;
  /** Order to pull in */
  ordering?: (keyof any | [keyof any, ("asc" | "desc")?])[];
  /** Default weight to initialize data with */
  weight?: number;
};

type ValidKey = number | string | Date | BufferSource;

export { zStream, clStream };
export type { ZStream, OfZStream, CLStream, OfCLStream, PullOptions, ValidKey };
