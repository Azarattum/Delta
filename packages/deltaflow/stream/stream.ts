import type { HasPromise, MaybePromise } from "./promise";
import { SyncPromise } from "./promise";
import { Scheduler } from "./scheduler";

const internal = Symbol();
const noop = () => {};

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

    const downstreams = new Set<(entity: Awaited<TOut>) => void>();
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
      downstreams.clear();
    }

    function connect(fn: (entity: Awaited<TOut>) => void) {
      if (!downstreams.size) init();
      downstreams.add(fn);

      return () => {
        if (downstreams.delete(fn) && !downstreams.size) dispose();
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
      return SyncPromise.all(queue.map((x) => push(...x))).then((output) => {
        let forward = true;
        const commit = options.flush?.(output, {
          preventDefault: () => void (forward = false),
          emit: emit as (entity: Awaited<ActualPull<TPull>>) => void,
        });
        if (commit) scheduler.current.enqueue(commit, 1);
        if (forward) scheduler.current.enqueue(() => output.forEach(emit), 0);
      });
    }

    function emit(entity: Awaited<TOut>) {
      downstreams.forEach((fn) =>
        SyncPromise.try(() => fn(entity)).catch((error) =>
          console.error("Unhandled error in downstream handler", error),
        ),
      );
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
      eager() {
        connect(noop);
        return this;
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

interface Stream<TOut, TIn extends any[] = unknown[], TOpt = undefined> {
  /** Listens to future pushes, pulls the current state, and returns a disconnect function. */
  subscribe(fn: (entity: Awaited<TOut>) => void, options?: TOpt): () => void;
  /** Listens to future pushes and returns a disconnect function. */
  connect(fn: (entity: Awaited<TOut>) => void): () => void;
  /** Consumes upstream until disposal. Idempotent. */
  eager(): this;
  /** Pushes to the stream */
  push(...entities: PartialEntities<TIn>): void;
  /** Pulls from the stream */
  pull(options?: TOpt): TOut;
  /** Immediately flushes all the pending stream pushes */
  flush(): MaybePromise<void>;
  /** Checks if the stream has pending changes */
  get isDirty(): boolean;

  [Symbol.dispose](): void;
  [internal]: any;
}

type PullOf<TStream> =
  TStream extends Stream<infer TOut, any[], any> ? TOut : never;

type PushOf<TStream> =
  TStream extends Stream<any, infer TIn, any> ? TIn : never;

type OptionsOf<TStream> =
  TStream extends Stream<any, any[], infer TPullOptions> ? TPullOptions : never;

type StreamExtensions = Record<string, unknown> & {
  [K in keyof Stream<unknown>]?: never;
};

type StreamOutput<T> = {
  /** Cancels automatic forwarding for this batch (if call synchronously). */
  preventDefault(): void;
  /** Immediately sends an owned output downstream without processing it again. */
  emit(entity: T): void;
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
  /** Prepares owned effects before forwarding. The returned commit runs after propagation. */
  flush?: (
    entities: Awaited<ActualPull<TPull>>[],
    output: StreamOutput<Awaited<ActualPull<TPull>>>,
  ) => void | (() => MaybePromise<void>);
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
  StreamOutput,
  StreamOptions,
  IsAsyncStream,
  PartialEntities,
  StreamExtensions,
};
