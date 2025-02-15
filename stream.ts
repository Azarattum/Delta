function stream<T, D extends any[] = [T]>(options: StreamOptions<T, D>) {
  return (...downstreams: Streamify<D>): Stream<T, D> => {
    const push = options.push ?? ((...entity: D) => entity[0]);
    const pull =
      options.pull ??
      ((options?) => push(...(downstreams.map((x) => x.pull(options)) as D))); // Should we use fetch here?
    const fetch =
      options.fetch ??
      ((...args) => downstreams.map((x, i) => args[i] ?? x.pull()) as D);

    const upstream: Set<(entity: T) => void> = new Set();
    const forward = (entity: T) => upstream.forEach((fn) => fn(entity));

    downstreams.forEach((downstream, i) => {
      downstream.connect((entity: T) => {
        const all = new Array(downstreams.length);
        all[i] = entity;
        forward(push(...fetch(...(all as D))));
      });
    });

    function connect(fn: (entity: T) => void) {
      upstream.add(fn);
      return () => upstream.delete(fn);
    }

    return {
      pull,
      push: (...entities: D) => forward(push(...entities)),
      connect,
      subscribe: (fn: (entity: T) => void) => {
        fn(pull());
        return connect(fn);
      },
    };
  };
}

type Streamify<T> = { [K in keyof T]: Stream<T[K]> };

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

type StreamOptions<T, D extends any[]> = {
  /** Describes the behavior when the stream need to fetch extra data from its downstreams */
  fetch?: (...entities: { [K in keyof D]: D[K] | undefined }) => D;
  /** Describes the behavior when somebody pushes to the stream */
  push?: (...entities: D) => T;
  /** Describes the behavior when somebody tries to pull from the stream */
  pull?: (options?: PullOptions<T>) => T;
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
