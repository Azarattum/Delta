import type { HasPromise, MaybePromise } from "./promise";
import { SyncPromise } from "./promise";
import { Scheduler } from "./scheduler";

const internal = Symbol();

function stream<
  TPush,
  TPull extends MaybePromise<TPush> = MaybePromise<TPush>,
  TIn extends any[] = [Awaited<TPull>],
  TOptions = undefined,
  TExtensions extends StreamExtensions = {},
  TThis = {},
>(
  options: StreamOptions<TPush, TPull, TIn, TOptions, TExtensions> &
    TThis &
    ThisType<TThis>,
) {
  type Upstreams = {
    [K in keyof TIn]: Stream<MaybePromise<TIn[K]>, any[], any> | null;
  };

  return <
    TUpstreams extends Upstreams,
    TOut = InferOut<TPush, TPull, TUpstreams>,
  >(
    ...upstreams: TUpstreams
  ): Stream<TOut, TIn, TOptions> & TExtensions => {
    const push = options.push?.bind(options) ?? ((...entity: TIn) => entity[0]);
    const pull =
      options.pull?.bind(options) ??
      ((options?) => {
        const entities = upstreams.map((x) => x?.pull(options));
        return SyncPromise.all(entities).then((x) => push(...(x as TIn)));
      });
    const compress =
      options.compress?.bind(options) ??
      ((queue) => {
        const length = queue.reduce((max, a) => Math.max(max, a!.length), 1);
        return Array.from({ length }, (_, i) =>
          queue.map((arr) => arr![i]),
        ) as PartialEntities<TIn>[];
      });

    const downstreams: Set<((entity: Awaited<TOut>) => void) | undefined> =
      new Set();
    const queue = [] as unknown as EntityQueue<TIn>;

    let scheduled = false;
    const scheduler = Scheduler.join(
      upstreams.map((x) => x?.[internal].scheduler).filter((x) => !!x),
      2,
    );

    let disposers: (void | (() => void))[] = [];
    function init() {
      disposers = upstreams.map((upstream, i) => {
        return upstream?.connect((entity: TIn[number]) => {
          (queue[i] ??= []).push(entity);
          schedule();
        });
      });

      if (options.init) disposers.push(options.init());
    }

    function dispose() {
      disposers.forEach((dispose) => dispose?.());
      disposers = [];
    }

    function connect(fn?: (entity: Awaited<TOut>) => void) {
      if (!downstreams.size) init();
      downstreams.add(fn);

      return () => {
        downstreams.delete(fn);
        if (!downstreams.size) dispose();
      };
    }

    function schedule() {
      if (!scheduled && upstreams.every((x) => !x?.isDirty)) {
        scheduled = true;
        scheduler.current.enqueue(() => {
          const compressed = compress(queue);
          scheduled = false;
          queue.length = 0;
          return process(compressed);
        }, 0);
      }
    }

    function process(queue: TIn[number][][]) {
      return SyncPromise.all(queue.map((x) => push(...x))).then((processed) => {
        if (options.flush) {
          const snapshot = structuredClone(processed);
          scheduler.current.enqueue(() => options.flush!(snapshot), 1);
        }

        processed.forEach((x) =>
          downstreams.forEach((fn) =>
            SyncPromise.try(() => fn?.(x)).catch((error) =>
              console.error("Unhandled error in downstream handler", error),
            ),
          ),
        );
      });
    }

    const stream: Stream<TOut, TIn, TOptions> = {
      pull: (options) => (scheduler.current.flush(), pull(options)),
      push: (...entities) => {
        entities.forEach((x, i) => x != null && (queue[i] ??= []).push(x));
        return schedule();
      },
      flush: () => scheduler.current.flush(),
      connect,
      subscribe: (fn, options) => {
        const dispose = connect(fn);
        SyncPromise.one(pull(options)).then(fn);
        return dispose;
      },
      get isDirty() {
        return !!(scheduled || upstreams.some((x) => x?.isDirty));
      },
      [Symbol.dispose]: dispose,
      [internal]: { scheduler },
    };

    if (options.extensions) {
      const extensions = Object.getOwnPropertyDescriptors(options.extensions);
      Object.defineProperties(stream, extensions);
    }

    return stream as Stream<TOut, TIn, TOptions> & TExtensions;
  };
}

type IsAsyncStream<TStream, TTrue = true, TFalse = false> = HasPromise<
  TStream extends Stream<infer TOut, any> ? TOut : never,
  TTrue,
  TFalse
>;

type InferOut<TPush, TPull, TUpstreams extends any[]> =
  // Check if TPull is exactly T | Promise<T> for some T
  (<U>() => U extends TPull ? 1 : 2) extends (
    <U>() => U extends MaybePromise<TPull> ? 1 : 2
  ) ?
    IsAsyncStream<
      TUpstreams[number],
      Promise<Awaited<TPull>>,
      HasPromise<TPush, Promise<Awaited<TPull>>, Awaited<TPull>>
    >
  : TPull;

type PartialEntities<T extends any[]> =
  T extends [infer U] ? [U] : { [K in keyof T]?: T[K] };

type EntityQueue<T extends any[]> =
  T extends [infer U] ? [U[]] : { [K in keyof T]?: T[K][] };

type Stream<TOut, TIn extends any[] = unknown[], TPullOptions = undefined> = {
  /** Subscribes to changes and immediately pulls the current state */
  subscribe(
    fn: (entity: Awaited<TOut>) => void,
    options?: TPullOptions,
  ): () => void;
  /** Subscribes to changes. The first connection initializes the graph (even without a handler fn) */
  connect(fn?: (entity: Awaited<TOut>) => void): () => void;
  /** Pushes to the stream */
  push(...entities: PartialEntities<TIn>): void;
  /** Pulls from the stream */
  pull(options?: TPullOptions): TOut;
  /** Immediately flushes all the pending stream pushes */
  flush(): MaybePromise<void>;
  /** Checks if the stream has pending changes */
  get isDirty(): boolean;

  [Symbol.dispose](): void;
  [internal]: any;
};

type StreamExtensions = Record<string, unknown> & {
  [K in keyof Stream<unknown>]?: never;
};

type StreamOptions<
  TOut,
  TPull extends MaybePromise<TOut> = MaybePromise<TOut>,
  TIn extends any[] = [Awaited<TPull>],
  TOptions = undefined,
  TExtensions extends StreamExtensions = {},
> = {
  /** Describes the behavior when somebody tries to pull from the stream */
  pull?: (options?: TOptions) => TPull;
  /** Describes the behavior when somebody pushes to the stream */
  push?: (...entities: PartialEntities<TIn>) => TOut;
  /** Describes any additional flush behavior */
  flush?: (entities: Awaited<TPull>[]) => MaybePromise<void>;
  /** Describes how to compress multiple pushes */
  compress?: (queue: EntityQueue<TIn>) => PartialEntities<TIn>[];
  /** Describes initialization that is called on the first subscriber and disposed on no subscribers */
  init?: () => void | (() => void);
  /** Extends the stream object with extra public API */
  extensions?: TExtensions &
    ThisType<Stream<TOut, TIn, TOptions> & TExtensions>;
};

export { stream };
export type {
  Stream,
  EntityQueue,
  StreamOptions,
  IsAsyncStream,
  PartialEntities,
  StreamExtensions,
};
