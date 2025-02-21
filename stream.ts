import { MergePromise, SyncPromise } from "./sync-promise";

function stream<TOut, TIn extends any[] = [TOut], TPull = unknown>(
  options: StreamOptions<TOut, TIn, TPull>,
) {
  type Downstreams = { [K in keyof TIn]: Stream<unknown, [TIn[K]]> };
  return <TDownstreams extends Downstreams>(
    ...downstreams: TDownstreams
  ): Stream<TOut, TIn, InferPull<TPull, TOut, TDownstreams>> => {
    const push = options.push ?? ((...entity: TIn) => entity[0]);
    const pull =
      options.pull ??
      ((options?) => {
        const entities = downstreams.map((x) => x.pull(options));
        return SyncPromise.all(entities).then((x) => push(...(x as TIn)));
      });

    const upstream: Set<(entity: TOut) => void> = new Set();
    const forward = (entity: TOut) => upstream.forEach((fn) => fn(entity));

    downstreams.forEach((downstream, i) => {
      downstream.connect((entity: TIn[number]) => {
        // TODO: defer and batch
        const all = new Array(downstreams.length) as PartialEntities<TIn>;
        all[i] = entity;
        forward(push(...all));
      });
    });

    function connect(fn: (entity: TOut) => void) {
      upstream.add(fn);
      return () => upstream.delete(fn);
    }

    return {
      pull,
      push: (...entities: TIn) => forward(push(...entities)),
      connect,
      subscribe: (fn: (entity: TOut) => void) => {
        fn(pull());
        return connect(fn);
      },
    };
  };
}

type InferPull<TPull, TOut, TDownstreams extends Stream<any>[]> =
  TPull extends TOut | Promise<TOut> ? TPull
  : MergePromise<
      TDownstreams[number] extends Stream<any, any, infer TPull> ? TPull : never
    >;

type PartialEntities<T extends any[]> =
  T extends [any] ? T : { [K in keyof T]?: T[K] };

type Stream<
  TOut,
  TIn extends any[] = unknown[],
  TPull extends TOut | Promise<TOut> = TOut,
> = {
  /** Subscribes to changes and immediately pulls the current state */
  subscribe(fn: (entity: TOut) => void): () => void;
  /** Subscribes to future changes without side-effects */
  connect(fn: (entity: TOut) => void): () => void;
  /** Pushes to the stream */
  push(...entities: TIn): void;
  /** Pulls from the stream */
  pull(options?: PullOptions): TPull;
};

type StreamOptions<TOut, TIn extends any[], TPull> = {
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
