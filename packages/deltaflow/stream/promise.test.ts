import { expect, it, mock } from "bun:test";
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

it("handles new sync resolution", () => {
  const promise = SyncPromise.new<number>((resolve) => resolve(42));

  expect(promise.then).toBeInstanceOf(Function);
  expect(promise.finally).toBeInstanceOf(Function);

  expect(promise.then((x) => x * 2)).toBe(84);

  const fn = mock();
  expect(promise.finally(fn)).toBe(42);
  expect(fn).toHaveBeenCalledTimes(1);
});

it("handles new async resolution", async () => {
  const promise = SyncPromise.new<number>((resolve) =>
    setTimeout(() => resolve(42)),
  );

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

it("handles new undefined resolution", async () => {
  const promise = SyncPromise.new<undefined>((resolve) => resolve(undefined));

  expect(promise.then).toBeInstanceOf(Function);
  expect(promise.finally).toBeInstanceOf(Function);

  expect(promise.then((x) => x === undefined)).toBe(true);

  const fn = mock();
  expect(promise.finally(fn)).toBe(undefined);
  expect(fn).toHaveBeenCalledTimes(1);
});

it("handles multiple then calls on async resolution", async () => {
  let resolve: ((value: number) => void) | undefined;
  const promise = SyncPromise.new<number>((r) => {
    resolve = (value) => setTimeout(() => r(value));
  });

  const then1 = mock();
  const then2 = mock();

  promise.then(then1);
  promise.then(then2);

  resolve!(42);

  await new Promise((r) => setTimeout(r));

  expect(then1).toHaveBeenCalledTimes(1);
  expect(then1).toHaveBeenCalledWith(42);
  expect(then2).toHaveBeenCalledTimes(1);
  expect(then2).toHaveBeenCalledWith(42);
});
