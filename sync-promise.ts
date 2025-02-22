function all<T extends any[]>(items: T): SyncPromises<T> {
  const hasPromise = items.some((x) => x instanceof Promise);
  if (hasPromise) return Promise.all(items) as any;
  return { then: (fn) => fn(items as any) as any, finally: (fn) => fn() };
}

function one<T>(item: T): SyncPromise<T> {
  if (item instanceof Promise) return item as any;
  return { then: (fn) => fn(item as any) as any, finally: (fn) => fn() };
}

export const SyncPromise = { all, one };

export type SyncPromise<T> = {
  then: <R>(fn: (x: Awaited<T>) => R) => IsPromise<T, Promise<R>, R>;
  finally: (fn: () => void) => void;
};

export type SyncPromises<T extends any[]> = {
  then: <R>(fn: (x: Awaited<T>) => R) => IsPromise<T, Promise<R>, R>;
  finally: (fn: () => void) => void;
};

export type IsPromise<T, TTrue = true, TFalse = false> =
  Promise<any> extends T ? TTrue : TFalse;

export type MaybePromise<T> = Awaited<T> | Promise<Awaited<T>>;

export type HasPromise<T, TTrue = true, TFalse = false> =
  [T] extends [never] ? never
  : Extract<T, Promise<any>> extends never ? TFalse
  : TTrue;
