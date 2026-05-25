import { expect, expectTypeOf, it, mock } from "bun:test";
import type { Follows } from "./promise";
import { SyncPromise } from "./promise";

it("handles one sync value", () => {
  const promise = SyncPromise.one(42);

  expect(promise.then).toBeInstanceOf(Function);
  expect(promise.finally).toBeInstanceOf(Function);

  expect(promise.then((x) => x * 2)).toBe(84);

  const fn = mock();
  expect(promise.finally(fn)).toBe(42);
  expect(fn).toHaveBeenCalledTimes(1);
});

it("handles one async value", async () => {
  const promise = SyncPromise.one(Promise.resolve(42));

  expect(promise.then).toBeInstanceOf(Function);
  expect(promise.finally).toBeInstanceOf(Function);

  expect(promise.then((x) => x * 2)).toBeInstanceOf(Promise);
  expect(promise.then((x) => x * 2)).resolves.toBe(84);

  const fn = mock();
  expect(promise.finally(fn));
  expect(fn).toHaveBeenCalledTimes(0);
  await expect(promise.finally(fn)).resolves.toBe(42);
  expect(fn).toHaveBeenCalledTimes(2);
});

it("handles promises returned from sync callbacks", async () => {
  const result = SyncPromise.one(42).then((x) => Promise.resolve(x * 2));

  expectTypeOf(result).toEqualTypeOf<Promise<number>>();
  expect(result).toBeInstanceOf(Promise);
  await expect(result).resolves.toBe(84);
});

it("preserves sync promises returned from sync callbacks", () => {
  const result = SyncPromise.one(42).then((x) => SyncPromise.one(x * 2));

  expectTypeOf(result).toEqualTypeOf<SyncPromise<number>>();
  expect(result.then((x) => x + 1)).toBe(85);
});

it("assimilates sync promises returned from async callbacks", async () => {
  const result = SyncPromise.one(Promise.resolve(42)).then((x) =>
    SyncPromise.one(x * 2),
  );

  expectTypeOf(result).toEqualTypeOf<Promise<number>>();
  expect(result).toBeInstanceOf(Promise);
  await expect(result).resolves.toBe(84);
});

it("returns the fulfilled value from sync catch", () => {
  const result = SyncPromise.one(42).catch(() => "fallback");

  expectTypeOf(result).toEqualTypeOf<42 | string>();
  expect(result).toBe(42);
});

it("handles promises returned from sync catch callbacks", async () => {
  const result = SyncPromise.try<number>(() => {
    throw new Error("boom");
  }).catch(() => Promise.resolve(42));

  expectTypeOf(result).toEqualTypeOf<number | Promise<number>>();
  expect(result).toBeInstanceOf(Promise);
  await expect(result).resolves.toBe(42);
});

it("assimilates catch callback promises for async values", async () => {
  const result = SyncPromise.one(Promise.reject(new Error("boom"))).catch(() =>
    Promise.resolve(42),
  );

  expectTypeOf(result).toEqualTypeOf<Promise<number>>();
  expect(result).toBeInstanceOf(Promise);
  await expect(result).resolves.toBe(42);
});

it("keeps finally result typed as the original value", async () => {
  const sync = SyncPromise.one(42).finally(() => Promise.resolve("ignored"));
  const async = SyncPromise.one(Promise.resolve(42)).finally(() =>
    Promise.resolve("ignored"),
  );

  expectTypeOf(sync).toEqualTypeOf<42>();
  expectTypeOf(async).toEqualTypeOf<Promise<number>>();
  expect(sync).toBe(42);
  await expect(async).resolves.toBe(42);
});

it("preserves T | Promise<T> through one", () => {
  const value = 42 as number | Promise<number>;
  const promise = SyncPromise.one(value);

  expectTypeOf(promise.then((x) => x * 2)).toEqualTypeOf<
    number | Promise<number>
  >();

  expectTypeOf(promise.then((x) => Promise.resolve(x * 2))).toEqualTypeOf<
    Promise<number>
  >();

  expectTypeOf(promise.then((x) => SyncPromise.one(x * 2))).toEqualTypeOf<
    SyncPromise<number> | Promise<number>
  >();

  expectTypeOf(promise.catch(() => "fallback")).toEqualTypeOf<
    number | string | Promise<number | string>
  >();

  expectTypeOf(promise.finally(() => Promise.resolve("ignored"))).toEqualTypeOf<
    number | Promise<number>
  >();
});

it("preserves T | Promise<T> through try", () => {
  const value = 42 as number | Promise<number>;
  const promise = SyncPromise.try(() => value);

  expectTypeOf(promise.then((x) => x * 2)).toEqualTypeOf<
    number | Promise<number>
  >();

  expectTypeOf(promise.then((x) => Promise.resolve(x * 2))).toEqualTypeOf<
    Promise<number>
  >();

  expectTypeOf(promise.catch(() => "fallback")).toEqualTypeOf<
    number | string | Promise<number | string>
  >();

  expectTypeOf(promise.finally(() => Promise.resolve("ignored"))).toEqualTypeOf<
    number | Promise<number>
  >();
});

it("handles try result types", async () => {
  const sync = SyncPromise.try(() => 42);
  const async = SyncPromise.try(() => Promise.resolve(42));
  const thrown = SyncPromise.try<number>(() => {
    throw new Error("boom");
  });

  expectTypeOf(sync.then((x) => x * 2)).toEqualTypeOf<number>();
  expectTypeOf(async.then((x) => x * 2)).toEqualTypeOf<Promise<number>>();
  expectTypeOf(thrown.catch(() => Promise.resolve(42))).toEqualTypeOf<
    number | Promise<number>
  >();

  expect(sync.then((x) => x * 2)).toBe(84);
  await expect(async.then((x) => x * 2)).resolves.toBe(84);
  await expect(thrown.catch(() => Promise.resolve(42))).resolves.toBe(42);
});

it("preserves T | Promise<T> through all", () => {
  const value = 42 as number | Promise<number>;
  const promise = SyncPromise.all([value, "tag"]);

  expectTypeOf(promise.then(([x, tag]) => [x * 2, tag] as const)).toEqualTypeOf<
    readonly [number, "tag"] | Promise<readonly [number, "tag"]>
  >();

  expectTypeOf(
    promise.then(([x, tag]) => Promise.resolve([x * 2, tag] as const)),
  ).toEqualTypeOf<Promise<readonly [number, "tag"]>>();

  expectTypeOf(
    promise.then(([x, tag]) => SyncPromise.one([x * 2, tag] as const)),
  ).toEqualTypeOf<
    SyncPromise<readonly [number, "tag"]> | Promise<readonly [number, "tag"]>
  >();

  expectTypeOf(promise.catch(() => ["fallback"] as const)).toEqualTypeOf<
    [number, "tag"] | Promise<[number, "tag"] | readonly ["fallback"]>
  >();

  expectTypeOf(promise.finally(() => Promise.resolve("ignored"))).toEqualTypeOf<
    [number, "tag"] | Promise<[number, "tag"]>
  >();
});

it("handles all result types", async () => {
  const sync = SyncPromise.all([1, 2]);
  const async = SyncPromise.all([1, Promise.resolve(2)]);
  const maybe = SyncPromise.all([1 as number | Promise<number>, 2]);

  expectTypeOf(sync.then(([x, y]) => x + y)).toEqualTypeOf<number>();
  expectTypeOf(async.then(([x, y]) => x + y)).toEqualTypeOf<Promise<number>>();
  expectTypeOf(maybe.then(([x, y]) => x + y)).toEqualTypeOf<
    number | Promise<number>
  >();

  expect(sync.then(([x, y]) => x + y)).toBe(3);
  await expect(async.then(([x, y]) => x + y)).resolves.toBe(3);
});

it("tracks nested dependencies through chains", () => {
  const sync = SyncPromise.one(1).then((x) =>
    SyncPromise.all([x, "tag"]).then(([x]) => x * 2),
  );
  const async = SyncPromise.one(1).then((x) =>
    SyncPromise.all([x, Promise.resolve("tag")]).then(([x]) => x * 2),
  );
  const maybe = SyncPromise.one(1 as number | Promise<number>).then((x) =>
    SyncPromise.all([x, "tag"]).then(([x]) => x * 2),
  );
  const asyncOuter = SyncPromise.one(Promise.resolve(1)).then((x) =>
    SyncPromise.all([x, "tag"]).then(([x]) => x * 2),
  );

  expectTypeOf(sync).toEqualTypeOf<number>();
  expectTypeOf(async).toEqualTypeOf<Promise<number>>();
  expectTypeOf(maybe).toEqualTypeOf<number | Promise<number>>();
  expectTypeOf(asyncOuter).toEqualTypeOf<Promise<number>>();
});

it("models chained promise groups conservatively", () => {
  type Sync = Follows<[number, string], boolean>;
  type Async = Follows<[number, Promise<string>], boolean>;
  type Maybe = Follows<[number | Promise<number>, string], boolean>;

  expectTypeOf<Sync>().toEqualTypeOf<boolean>();
  expectTypeOf<Async>().toEqualTypeOf<Promise<boolean>>();
  expectTypeOf<Maybe>().toEqualTypeOf<boolean | Promise<boolean>>();
});

it("handles all sync values", () => {
  const promise = SyncPromise.all([1, 2, 3]);

  expect(promise.then).toBeInstanceOf(Function);
  expect(promise.finally).toBeInstanceOf(Function);

  expect(promise.then((x) => x.map((y) => y * 2))).toEqual([2, 4, 6]);

  const fn = mock();
  expect(promise.finally(fn)).toEqual([1, 2, 3]);
  expect(fn).toHaveBeenCalledTimes(1);
});

it("handles all async values", async () => {
  const promise = SyncPromise.all([
    Promise.resolve(1),
    Promise.resolve(2),
    Promise.resolve(3),
  ]);

  expect(promise.then).toBeInstanceOf(Function);
  expect(promise.finally).toBeInstanceOf(Function);

  expect(promise.then((x) => x.map((y) => y * 2))).toBeInstanceOf(Promise);
  expect(promise.then((x) => x.map((y) => y * 2))).resolves.toEqual([2, 4, 6]);

  const fn = mock();
  expect(promise.finally(fn));
  expect(fn).toHaveBeenCalledTimes(0);
  await expect(promise.finally(fn)).resolves.toEqual([1, 2, 3]);
  expect(fn).toHaveBeenCalledTimes(2);
});

it("handles all mixed sync and async values", async () => {
  const promise = SyncPromise.all([1, Promise.resolve(2), 3]);

  expect(promise.then).toBeInstanceOf(Function);
  expect(promise.finally).toBeInstanceOf(Function);

  expect(promise.then((x) => x.map((y) => y * 2))).toBeInstanceOf(Promise);
  expect(promise.then((x) => x.map((y) => y * 2))).resolves.toEqual([2, 4, 6]);

  const fn = mock();
  expect(promise.finally(fn));
  expect(fn).toHaveBeenCalledTimes(0);
  await expect(promise.finally(fn)).resolves.toEqual([1, 2, 3]);
  expect(fn).toHaveBeenCalledTimes(2);
});
