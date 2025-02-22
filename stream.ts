import type { HasPromise, MaybePromise } from "./sync-promise";
import { SyncPromise } from "./sync-promise";

function stream<
  TPush,
  TPull extends MaybePromise<TPush> = MaybePromise<TPush>,
  TIn extends any[] = [Awaited<TPull>],
>(options: StreamOptions<TPush, TPull, TIn>) {
  type Downstreams = { [K in keyof TIn]: Stream<unknown, [TIn[K]]> | null };

  return <
    TDownstreams extends Downstreams,
    TOut = InferOut<TPush, TPull, TDownstreams>,
    TFlush extends MaybePromise<void> = InferFlush<TPush, TDownstreams>,
  >(
    ...downstreams: TDownstreams
  ): Stream<TOut, TIn, TFlush> => {
    const push = options.push ?? ((...entity: TIn) => entity[0]);
    const pull =
      options.pull ??
      ((options?) => {
        const entities = downstreams.map((x) => x?.pull(options));
        return SyncPromise.all(entities).then((x) => push(...(x as TIn)));
      });

    let flushing: void | Promise<void> | null = null;
    const queue: PartialEntities<TIn>[] = [];
    const upstream: Set<(entity: Awaited<TOut>) => void> = new Set();

    downstreams.forEach((downstream, i) => {
      downstream?.connect((entity: TIn[number]) => {
        const entities = new Array() as PartialEntities<TIn>;
        entities[i] = entity;
        forward(entities);
      });
    });

    function connect(fn: (entity: Awaited<TOut>) => void) {
      upstream.add(fn);
      return () => upstream.delete(fn);
    }

    function forward(entities: PartialEntities<TIn>) {
      const shouldSchedule = queue.length === 0;
      const last = queue[queue.length - 1];
      const canMerge =
        last && entities.every((x, i) => x == null || last[i] == null);

      if (canMerge) entities.forEach((x, i) => (last[i] = x));
      else queue.push(entities);

      if (shouldSchedule) queueMicrotask(flush);
    }

    function flush() {
      return (flushing ??= SyncPromise.all(
        downstreams.map((x) => x?.flush()),
      ).then(() => {
        if (!queue.length) return;
        try {
          return SyncPromise.all(
            queue.map((entities) =>
              SyncPromise.one(push(...entities)).then((x) =>
                upstream.forEach((fn) => fn(x)),
              ),
            ),
          ).finally(() => (flushing = null));
        } finally {
          queue.length = 0;
        }
      })) as TFlush;
    }

    return {
      flush,
      pull: (options) => (flush(), pull(options)),
      push: (...entities) => forward(entities),
      connect,
      subscribe: (fn) => {
        SyncPromise.one(pull()).then(fn);
        return connect(fn);
      },
      get isDirty() {
        return !!(
          flushing ||
          queue.length > 0 ||
          downstreams.some((x) => x?.isDirty)
        );
      },
    };
  };
}

type InferFlush<TPush, TDownstreams extends any[]> =
  // Check if the push or any downstream TFlush has a Promise
  HasPromise<
    | TPush
    | (TDownstreams[number] extends Stream<any, any, infer TFlush> ? TFlush
      : never),
    Promise<void>,
    void
  >;

type InferOut<TPush, TPull, TDownstreams extends any[]> =
  // Check if TPull is exactly T | Promise<T> for some T
  (<U>() => U extends TPull ? 1 : 2) extends (
    <U>() => U extends MaybePromise<TPull> ? 1 : 2
  ) ?
    // Check if the push or any downstream TOut has a Promise
    HasPromise<
      TDownstreams[number] extends Stream<infer TOut, any, any> ? TOut | TPush
      : never,
      Promise<Awaited<TPull>>,
      Awaited<TPull>
    >
  : TPull;

type PartialEntities<T extends any[]> =
  T extends [any] ? [Awaited<T[0]>] : { [K in keyof T]?: Awaited<T[K]> };

type Stream<
  TOut,
  TIn extends any[] = unknown[],
  TFlush extends MaybePromise<void> = void,
> = {
  /** Subscribes to changes and immediately pulls the current state */
  subscribe(fn: (entity: Awaited<TOut>) => void): () => void;
  /** Subscribes to future changes without side-effects */
  connect(fn: (entity: Awaited<TOut>) => void): () => void;
  /** Pushes to the stream */
  push(...entities: PartialEntities<TIn>): void;
  /** Pulls from the stream */
  pull(options?: PullOptions): TOut;
  /** Immediately flushes all the pending stream pushes */
  flush(): TFlush;
  /** Checks if the stream has pending changes */
  get isDirty(): boolean;
};

type StreamOptions<
  TOut,
  TPull extends MaybePromise<TOut> = MaybePromise<TOut>,
  TIn extends any[] = [Awaited<TPull>],
> = {
  /** Describes the behavior when somebody tries to pull from the stream */
  pull?: (options?: PullOptions) => TPull;
  /** Describes the behavior when somebody pushes to the stream */
  push?: (...entities: PartialEntities<TIn>) => TOut;
};

/** TODO: these should be datatype specific */
type PullOptions = {
  /** Lookup and order by provided keys */
  constraints?: Record<string, unknown>[];
};

export { stream };
export type { Stream, StreamOptions };
