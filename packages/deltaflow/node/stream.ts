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
  options: StreamOptions<TPush, TPull, TIn>,
) =>
  stream({
    compress: (queue) => {
      return [
        queue.map((x) => x?.reduce((acc, x) => add(acc, x, false))),
      ] as PartialEntities<TIn>[];
    },
    ...options,
  });

type ZStream<T = any> = Stream<ZSet<T> | Promise<ZSet<T>>>;
type OfZStream<T extends Stream<any>> = T extends ZStream<infer U> ? U : never;

// TODO: CL specific stream implementation (compress CLSets)
const clStream = <
  TPush extends CLSet<any>,
  TPull extends MaybePromise<TPush> = MaybePromise<TPush>,
  TIn extends CLSet<any>[] = [Awaited<TPull>],
>(
  options: StreamOptions<TPush, TPull, TIn>,
) => stream(options);

type CLStream<T = any> = Stream<CLSet<T> | Promise<CLSet<T>>>;
type OfCLStream<T extends Stream<any>> =
  T extends CLStream<infer U> ? U : never;

export { zStream, clStream };
export type { ZStream, OfZStream, CLStream, OfCLStream };
