import type { HasPromise, MaybePromise } from "./promise";
import { SyncPromise } from "./promise";
import { Scheduler } from "./scheduler";

const internal = Symbol();

function stream<
  TPush,
  TPull extends MaybePromise<TPush> = MaybePromise<TPush>,
  TIn extends any[] = [Awaited<TPull>],
  TFlush extends MaybePromise<void> = void,
>(options: StreamOptions<TPush, TPull, TIn, TFlush>) {
  type Upstreams = { [K in keyof TIn]: Stream<unknown, [TIn[K]]> | null };

  return <
    TUpstreams extends Upstreams,
    TOut = InferOut<TPush, TPull, TUpstreams>,
  >(
    ...upstreams: TUpstreams
  ): Stream<TOut, TIn, InferFlush<TPush, TFlush, TUpstreams>> => {
    const push = options.push ?? ((...entity: TIn) => entity[0]);
    const pull =
      options.pull ??
      ((options?) => {
        const entities = upstreams.map((x) => x?.pull(options));
        return SyncPromise.all(entities).then((x) => push(...(x as TIn)));
      });

    let queue: PartialEntities<TIn>[] = [];
    const downstreams: Set<(entity: Awaited<TOut>) => void> = new Set();

    let scheduled = false;
    const scheduler = Scheduler.join(
      upstreams.map((x) => x?.[internal].scheduler).filter((x) => !!x),
      2,
    );

    upstreams.forEach((upstream, i) => {
      upstream?.connect((entity: TIn[number]) => {
        const entities = new Array() as PartialEntities<TIn>;
        entities[i] = entity;
        forward(entities);
      });
    });

    function connect(fn: (entity: Awaited<TOut>) => void) {
      downstreams.add(fn);
      return () => downstreams.delete(fn);
    }

    function forward(entities: PartialEntities<TIn>) {
      const last = queue[queue.length - 1];
      const canMerge =
        last && entities.every((x, i) => x == null || last[i] == null);

      if (canMerge) entities.forEach((x, i) => (last[i] = x));
      else queue.push(entities);

      if (!scheduled && queue.length && upstreams.every((x) => !x?.isDirty)) {
        scheduled = true;
        scheduler.current.enqueue(() => {
          scheduled = false;
          if (options.flush) {
            const snapshot = structuredClone(queue);
            scheduler.current.enqueue(() => options.flush!(snapshot), 1);
          }
          return process().then(() => undefined);
        }, 0);
      }
    }

    function process() {
      const toProcess = queue;
      queue = [];
      return SyncPromise.all(
        toProcess.map((entities) =>
          SyncPromise.one(push(...entities)).then((x) =>
            downstreams.forEach((fn) => fn(x)),
          ),
        ),
      );
    }

    return {
      flush: () => scheduler.current.flush() as any, // TODO: consider MaybePromise here
      pull: (options) => (scheduler.current.flush(), pull(options)),
      push: (...entities) => forward(entities),
      connect,
      subscribe: (fn) => {
        SyncPromise.one(pull()).then(fn);
        return connect(fn);
      },
      get isDirty() {
        return !!(queue.length > 0 || upstreams.some((x) => x?.isDirty));
      },
      [internal]: { scheduler },
    };
  };
}

// TODO: consider that flush should always be MaybePromise, since we cannot
//   really guarantee its type because it also depends on the downstream
type InferFlush<TPush, TFlush, TUpstreams extends any[]> =
  // Check if the push, flush or any upstream TFlush has a Promise
  HasPromise<
    | TFlush
    | (unknown extends TPush ? void : TPush)
    | (TUpstreams[number] extends Stream<any, any, infer TFlush> ? TFlush
      : never),
    Promise<void>,
    void
  >;

type InferOut<TPush, TPull, TUpstreams extends any[]> =
  // Check if TPull is exactly T | Promise<T> for some T
  (<U>() => U extends TPull ? 1 : 2) extends (
    <U>() => U extends MaybePromise<TPull> ? 1 : 2
  ) ?
    // Check if the push or any upstream TOut has a Promise
    HasPromise<
      TUpstreams[number] extends Stream<infer TOut, any, any> ? TOut | TPush
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

  [internal]: any;
};

type StreamOptions<
  TOut,
  TPull extends MaybePromise<TOut> = MaybePromise<TOut>,
  TIn extends any[] = [Awaited<TPull>],
  TFlush extends MaybePromise<void> = void,
> = {
  /** Describes the behavior when somebody tries to pull from the stream */
  pull?: (options?: PullOptions) => TPull;
  /** Describes the behavior when somebody pushes to the stream */
  push?: (...entities: PartialEntities<TIn>) => TOut;
  /** Describes any additional flush behavior */
  flush?: (entities: PartialEntities<TIn>[]) => TFlush;
};

/** TODO: these should be datatype specific */
type PullOptions = {
  /** Lookup and order by provided keys */
  constraints?: Record<string, unknown>[];
};

export { stream };
export type { Stream, StreamOptions };
