function all<const T extends any[]>(values: T): SyncPromises<T> {
  const hasPromise = values.some((x) => x instanceof Promise);
  if (hasPromise) return Promise.all(values) as any;
  return {
    then: (fn): any => fn(values as any),
    finally: (fn): any => (fn(), values),
  };
}

function one<const T>(value: T | Promise<T>): SyncPromise<T> {
  if (value instanceof Promise) return value as any;
  return {
    then: (fn): any => fn(value as Awaited<T>),
    finally: (fn): any => (fn(), value),
  };
}

export const SyncPromise = { all, one };

export type SyncPromise<T> = {
  then: <R>(fn: (x: Awaited<T>) => R) => IsPromise<T, Promise<R>, R>;
  finally: (fn: () => void) => IsPromise<T, Promise<T>, T>;
};

export type SyncPromises<T extends any[]> = {
  then: <R>(fn: (x: AwaitedAll<T>) => R) => IsPromise<T, Promise<R>, R>;
  finally: (
    fn: () => void,
  ) => HasPromise<T[keyof T], Promise<AwaitedAll<T>>, AwaitedAll<T>>;
};

export type AwaitedAll<T extends any[]> = {
  [K in keyof T]: Awaited<T[K]>;
};

export type IsPromise<T, TTrue = true, TFalse = false> =
  Promise<any> extends T ? TTrue : TFalse;

export type MaybePromise<T> = Awaited<T> | Promise<Awaited<T>>;

export type HasPromise<T, TTrue = true, TFalse = false> =
  [T] extends [never] ? never
  : Extract<T, Promise<any>> extends never ? TFalse
  : TTrue;
