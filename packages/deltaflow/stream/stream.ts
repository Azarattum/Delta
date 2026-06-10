import type { HasPromise, MaybePromise } from "./promise";
import { SyncPromise } from "./promise";
import { Scheduler } from "./scheduler";

const internal = Symbol();

function stream<
  TPush,
  TPull extends DefaultPull<NoInfer<TPush>> = DefaultPull<TPush>,
  TIn extends any[] = [Awaited<ActualPull<TPull>>],
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
    const scheduler = couple(...upstreams);

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
      if (!downstreams.size && !options.flush) init();
      downstreams.add(fn);

      return () => {
        downstreams.delete(fn);
        if (!downstreams.size && !options.flush) dispose();
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
      pull: (options) => (scheduler.current.flush(), pull(options) as TOut),
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

    if (options.flush) init(); // Auto-init streams with side-effects
    return stream as Stream<TOut, TIn, TOptions> & TExtensions;
  };
}

/** Makes streams share one scheduler, so queued work flushes in the same cycle. */
function couple(...streams: (Stream<unknown> | null)[]) {
  const schedulers = streams
    .map((x) => x?.[internal].scheduler)
    .filter((x) => !!x);

  return Scheduler.join(schedulers, 2);
}

declare const defaultPull: unique symbol;
type ActualPull<TPull> = Exclude<TPull, typeof defaultPull>;
type DefaultPull<TPush> = MaybePromise<TPush> | typeof defaultPull;

type IsAsyncStream<TStream, TTrue = true, TFalse = false> = HasPromise<
  PullOf<TStream>,
  TTrue,
  TFalse
>;

type InferOut<TPush, TPull, TUpstreams extends any[]> =
  typeof defaultPull extends TPull ?
    IsAsyncStream<
      TUpstreams[number],
      Promise<Awaited<TPush>>,
      HasPromise<TPush, Promise<Awaited<TPush>>, Awaited<TPush>>
    >
  : ActualPull<TPull>;

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

type PullOf<TStream> =
  TStream extends Stream<infer TOut, any[], any> ? TOut : never;

type PushOf<TStream> =
  TStream extends Stream<any, infer TIn, any> ? TIn : never;

type OptionsOf<TStream> =
  TStream extends Stream<any, any[], infer TPullOptions> ? TPullOptions : never;

type StreamExtensions = Record<string, unknown> & {
  [K in keyof Stream<unknown>]?: never;
};

type StreamOptions<
  TOut,
  TPull extends DefaultPull<NoInfer<TOut>> = DefaultPull<TOut>,
  TIn extends any[] = [Awaited<ActualPull<TPull>>],
  TOptions = undefined,
  TExtensions extends StreamExtensions = {},
> = {
  /** Describes the behavior when somebody tries to pull from the stream */
  pull?: (options?: TOptions) => TPull;
  /** Describes the behavior when somebody pushes to the stream */
  push?: (...entities: PartialEntities<TIn>) => TOut;
  /** Describes any additional flush behavior */
  flush?: (entities: Awaited<ActualPull<TPull>>[]) => MaybePromise<void>;
  /** Describes how to compress multiple pushes */
  compress?: (queue: EntityQueue<TIn>) => PartialEntities<TIn>[];
  /** Describes initialization that is called on the first subscriber and disposed on no subscribers */
  init?: () => void | (() => void);
  /** Extends the stream object with extra public API */
  extensions?: TExtensions &
    ThisType<Stream<TOut, TIn, TOptions> & TExtensions>;
};

export { stream, couple };
export type {
  Stream,
  PullOf,
  PushOf,
  OptionsOf,
  ActualPull,
  DefaultPull,
  EntityQueue,
  StreamOptions,
  IsAsyncStream,
  PartialEntities,
  StreamExtensions,
};
