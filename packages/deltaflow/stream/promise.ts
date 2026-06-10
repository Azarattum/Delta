function all<const T extends any[]>(values: T): SyncPromises<T> {
  const hasPromise = values.some((x) => x instanceof Promise);
  if (hasPromise) return Promise.all(values) as any;
  return {
    then: (fn: any): any => fn(values as any),
    finally: (fn): any => (fn(), values),
    catch: (): any => values,
  };
}

function one<const T>(value: T): SyncPromise<T> {
  if (value instanceof Promise) return value as any;
  return {
    then: (fn: any): any => fn(value as Awaited<T>),
    finally: (fn): any => (fn(), value),
    catch: (): any => value,
  };
}

function wrap<const T>(valueFn: () => T) {
  try {
    const value = valueFn();
    return one(value);
  } catch (error) {
    return {
      then: (): any => {},
      catch: (fn: any): any => fn(error),
      finally: (fn): any => (fn(), error),
    } as SyncPromise<T>;
  }
}

export const SyncPromise = { all, one, try: wrap };

export type SyncPromise<T> = {
  catch: <R>(fn: (e: unknown) => R) => FollowsOne<T, Awaited<T> | Chain<R>>;
  then: <R>(fn: (x: Awaited<T>) => R) => FollowsOne<T, Chain<R>>;
  finally: (fn: () => void) => FollowsOne<T, Awaited<T>>;
};

export type SyncPromises<T extends any[]> = {
  catch: <R>(fn: (e: unknown) => R) => true extends DefinitePromise<T> ?
    Promise<AwaitedAll<T> | Awaited<Chain<R>>>
  : MaybePromiseIn<T> extends never ? AwaitedAll<T>
  : AwaitedAll<T> | Promise<AwaitedAll<T> | Awaited<Chain<R>>>;
  then: <R>(fn: (x: AwaitedAll<T>) => R) => Follows<T, Chain<R>>;
  finally: (fn: () => void) => Follows<T, AwaitedAll<T>>;
};

export type AwaitedAll<T extends any[]> = {
  [K in keyof T]: Awaited<T[K]>;
};

export type IsPromise<T, TTrue = true, TFalse = false> =
  T extends Promise<any> ? TTrue : TFalse;

export type MaybePromise<T> = Awaited<T> | Promise<Awaited<T>>;

export type Follows<TPromises extends any[], TValue> =
  true extends DefinitePromise<TPromises> ? Promise<Awaited<TValue>>
  : MaybePromiseIn<TPromises> extends never ? TValue
  : TValue | Promise<Awaited<TValue>>;

type FollowsOne<TPromise, TValue> = IsPromise<
  TPromise,
  Promise<Awaited<TValue>>,
  TValue
>;

type Chain<T> =
  [T] extends [Promise<any>] ? Promise<Awaited<T>>
  : [T] extends [SyncPromise<any>] ? T
  : Awaited<T>;

type DefinitePromise<T extends any[]> = {
  [K in keyof T]: [T[K]] extends [Promise<any>] ? true : false;
}[number];

type MaybePromiseIn<T extends any[]> = Extract<T[number], Promise<any>>;

export type HasPromise<T, TTrue = true, TFalse = false> =
  [T] extends [never] ? never
  : Extract<T, Promise<any>> extends never ? TFalse
  : TTrue;
