import type { CLSet } from "../datastructure/clset";
import type { ZSet } from "../datastructure/zset";
import type { Stream } from "../stream";

type ZStream<T = any> = Stream<ZSet<T> | Promise<ZSet<T>>>;
type OfZStream<T extends Stream<any>> = T extends ZStream<infer U> ? U : never;

type CLStream<T = any> = Stream<CLSet<T> | Promise<CLSet<T>>>;
type OfCLStream<T extends Stream<any>> =
  T extends CLStream<infer U> ? U : never;

export type { ZStream, OfZStream, CLStream, OfCLStream };
