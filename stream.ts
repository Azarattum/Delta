function stream<TOut, TIn extends any[] = [TOut]>(
  options: StreamOptions<TOut, TIn>,
) {
  return (...downstreams: Streamify<TIn>): Stream<TOut, TIn> => {
    const push = options.push ?? ((...entity: TIn) => entity[0]);
    const pull =
      options.pull ??
      ((options?) => push(...(downstreams.map((x) => x.pull(options)) as TIn)));

    const upstream: Set<(entity: TOut) => void> = new Set();
    const forward = (entity: TOut) => upstream.forEach((fn) => fn(entity));

    downstreams.forEach((downstream, i) => {
      downstream.connect((entity: TOut) => {
        // TODO: defer and batch
        const all = new Array(downstreams.length);
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

type Streamify<T> = { [K in keyof T]: Stream<T[K]> };

type PartialEntities<T extends any[]> =
  T extends [any] ? T : { [K in keyof T]?: T[K] };

type Stream<T, D extends any[] = unknown[]> = {
  /** Subscribes to changes and immediately pulls the current state */
  subscribe(fn: (entity: T) => void): () => void;
  /** Subscribes to future changes without side-effects */
  connect(fn: (entity: T) => void): () => void;
  /** Pushes to the stream */
  push(...entities: D): void;
  /** Pulls from the stream */
  pull(options?: PullOptions<T>): T;
};

type StreamOptions<TOut, TIn extends any[]> = {
  /** Describes the behavior when somebody pushes to the stream */
  push?: (...entities: PartialEntities<TIn>) => TOut;
  /** Describes the behavior when somebody tries to pull from the stream */
  pull?: (options?: PullOptions<TOut>) => TOut;
};

/** TODO: these should be datatype specific */
type PullOptions<T> = {
  /** Lookup and order by provided keys */
  constraints?: Record<string, unknown>[];
  /** Return with 0 weight */
  zero?: boolean;
};

export { stream };
export type { Stream, StreamOptions };
