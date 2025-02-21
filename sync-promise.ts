function all<T extends any[]>(items: T): SyncPromises<T> {
  const hasPromise = items.some((x) => x instanceof Promise);
  if (hasPromise) return Promise.all(items) as any;
  return { then: (fn) => fn(items as any) as any };
}

function one<T>(item: T): SyncPromise<T> {
  if (item instanceof Promise) return item as any;
  return { then: (fn) => fn(item as any) as any };
}

export const SyncPromise = { all, one };

export type SyncPromise<T> = {
  then: <R>(fn: (x: Awaited<T>) => R) => IsPromise<T, Promise<R>, R>;
};

export type SyncPromises<T extends any[]> = {
  then: <R>(fn: (x: Awaited<T>) => R) => IsPromise<T, Promise<R>, R>;
};

export type IsPromise<T, TTrue = true, TFalse = false> =
  Promise<any> extends T ? TTrue : TFalse;
