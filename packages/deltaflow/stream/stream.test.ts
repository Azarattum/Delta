import { expect, expectTypeOf, it, mock, spyOn } from "bun:test";
import { type Stream, stream } from "./stream";
import type { MaybePromise } from "./promise";

it("streams lazily", () => {
  const spyPull = mock(() => 123);
  const source = stream({ pull: spyPull, push: () => 0 })();
  const noop = stream<number>({});
  const node = noop(source);

  expect(spyPull).not.toHaveBeenCalled();
  node.pull();
  expect(spyPull).toHaveBeenCalledTimes(1);
});

it("handles async pulls", () => {
  const asyncSource = stream({
    push: (x: number) => x!,
    pull: () => Promise.resolve(42),
  })(null);
  const syncSource = stream({
    push: (x: number) => x!,
    pull: () => 42,
  })(null);

  expectTypeOf(asyncSource).toEqualTypeOf<Stream<Promise<number>, [number]>>();
  expectTypeOf(syncSource).toEqualTypeOf<Stream<number, [number]>>();

  const spy = mock();
  asyncSource.connect(spy);
  asyncSource.push(5);
  asyncSource.flush();
  expect(spy).toHaveBeenLastCalledWith(5);

  expect(asyncSource.pull()).toBeInstanceOf(Promise);
  expectTypeOf(asyncSource.pull()).toEqualTypeOf<Promise<number>>();

  const single = stream({ push: (x: number) => x.toString() });
  const multiple = stream({
    push: (a?: number, b?: number) => ((a || 0) + (b || 0)).toString(),
  });

  {
    const fromAsync = single(asyncSource);
    expectTypeOf(fromAsync).toEqualTypeOf<Stream<Promise<string>, [number]>>();
    expect(fromAsync.pull()).toBeInstanceOf(Promise);
    expect(fromAsync.pull()).resolves.toBe("42");
    expectTypeOf(fromAsync.pull()).toEqualTypeOf<Promise<string>>();

    const fromSync = single(syncSource);
    expectTypeOf(fromSync).toEqualTypeOf<Stream<string, [number]>>();
    expect(fromSync.pull()).toBe("42");
    expectTypeOf(fromSync.pull()).toEqualTypeOf<string>();
  }
  {
    const fromAsync = multiple(asyncSource, asyncSource);
    expectTypeOf(fromAsync).toEqualTypeOf<
      Stream<Promise<string>, [number, number]>
    >();
    expect(fromAsync.pull()).toBeInstanceOf(Promise);
    expect(fromAsync.pull()).resolves.toBe("84");
    expectTypeOf(fromAsync.pull()).toEqualTypeOf<Promise<string>>();

    const fromSync = multiple(syncSource, syncSource);
    expectTypeOf(fromSync).toEqualTypeOf<Stream<string, [number, number]>>();
    expect(fromSync.pull()).toBe("84");
    expectTypeOf(fromSync.pull()).toEqualTypeOf<string>();

    const fromBoth = multiple(syncSource, asyncSource);
    expectTypeOf(fromBoth).toEqualTypeOf<
      Stream<Promise<string>, [number, number]>
    >();
    expect(fromBoth.pull()).toBeInstanceOf(Promise);
    expect(fromBoth.pull()).resolves.toBe("84");
    expectTypeOf(fromBoth.pull()).toEqualTypeOf<Promise<string>>();
  }

  const syncify = stream({
    push: (x: number) => x.toString(),
    pull: () => "1337",
  });

  {
    const fromAsync = syncify(asyncSource);
    expectTypeOf(fromAsync).toEqualTypeOf<Stream<string, [number]>>();
    expect(fromAsync.pull()).toBe("1337");
    expectTypeOf(fromAsync.pull()).toEqualTypeOf<string>();
  }
});

it("batches changes to a microtask", async () => {
  const source = stream({
    push: (x: number) => x!,
  })(null);

  let count = 0;
  const sink = stream({
    push: (x: number) => (count += x),
    pull: () => count,
  })(source);

  source.push(1);
  source.push(2);
  expect(count).toBe(0);

  expect(sink.pull()).toBe(3);
  expect(count).toBe(3);

  source.push(3);
  expect(count).toBe(3);
  sink.flush();
  expect(count).toBe(6);

  source.push(4);
  await Promise.resolve();
  expect(count).toBe(10);
});

it("merges batched changes", async () => {
  const source1 = stream({ pull: () => 42 })(null);
  const source2 = stream({ pull: () => 1337 })(null);

  expectTypeOf(source1).toEqualTypeOf<Stream<number, [number]>>();

  {
    const spy = mock((_1?: number, _2?: number) => 0 as const);
    const joined = stream({ push: spy })(source1, source2);

    expectTypeOf(joined.flush).returns.toEqualTypeOf<MaybePromise<void>>();
    expectTypeOf(joined.pull).returns.toEqualTypeOf<0>();

    source1.push(1);
    source2.push(2);
    expect(spy).toHaveBeenCalledTimes(0);
    joined.flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(1, 2);
    expect(joined.pull()).toBe(0);
    expect(spy).toHaveBeenCalledTimes(2);

    source1.push(3);
    source2.push(4);
    source2.push(5);
    expect(spy).toHaveBeenCalledTimes(2);
    joined.flush();
    expect(spy).toHaveBeenCalledTimes(4);
    expect(spy).toHaveBeenNthCalledWith(2, 42, 1337);
    expect(spy).toHaveBeenNthCalledWith(3, 3, 4);
    expect(spy).toHaveBeenNthCalledWith(4, undefined, 5);
  }
  {
    const spy = mock(async (_1?: number, _2?: number) => 0 as const);
    const joined = stream({ push: spy })(source1, source2);

    expectTypeOf(joined.flush).returns.toEqualTypeOf<MaybePromise<void>>();
    expectTypeOf(joined.pull).returns.toEqualTypeOf<Promise<0>>();

    source1.push(1);
    source2.push(2);
    expect(spy).toHaveBeenCalledTimes(0);
    await joined.flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(1, 2);
    expect(await joined.pull()).toBe(0);
    expect(spy).toHaveBeenCalledTimes(2);

    source1.push(3);
    source2.push(4);
    source2.push(5);
    expect(spy).toHaveBeenCalledTimes(2);
    await joined.flush();
    expect(spy).toHaveBeenCalledTimes(4);
    expect(spy).toHaveBeenNthCalledWith(2, 42, 1337);
    expect(spy).toHaveBeenNthCalledWith(3, 3, 4);
    expect(spy).toHaveBeenNthCalledWith(4, undefined, 5);
  }
});

it("handles async pushes", async () => {
  const source = stream({
    push: (x: number) => Promise.resolve(x),
  })(null);

  expectTypeOf(source).toEqualTypeOf<Stream<never, [number]>>();

  let count = 0;
  const view = stream({
    push: (x: number) => (count += x),
    pull: () => count,
  })(source);

  expectTypeOf(view).toEqualTypeOf<Stream<number, [number]>>();

  expectTypeOf(source.pull).returns.toEqualTypeOf<never>();
  expectTypeOf(source.flush).returns.toEqualTypeOf<MaybePromise<void>>();
  expectTypeOf(view.pull).returns.toEqualTypeOf<number>();
  expectTypeOf(view.flush).returns.toEqualTypeOf<MaybePromise<void>>();
  expectTypeOf(source.push).returns.toEqualTypeOf<void>();
  expectTypeOf(view.push).returns.toEqualTypeOf<void>();

  source.push(1);
  expect(view.isDirty).toBe(true);
  expect(view.pull()).toBe(0);
  await view.flush();
  expect(view.pull()).toBe(1);
  expect(view.isDirty).toBe(false);

  const source1 = stream<number>({ pull: () => 42 })(null);
  const source2 = stream<number>({ pull: () => 1337 })(null);

  count = 0;
  const spy = mock((a?: number, b?: number) => (count += (a || 0) + (b || 0)));
  const joined = stream({
    push: (a?: number, b?: number) => Promise.resolve().then(() => spy(a, b)),
    pull: () => count,
  })(source1, source2);

  expectTypeOf(joined.pull).returns.toEqualTypeOf<number>();
  expect(joined.pull()).toBe(0);
  expect(count).toBe(0);

  source1.push(1);
  source2.push(2);
  expectTypeOf(joined.flush).returns.toEqualTypeOf<MaybePromise<void>>();
  const promise = joined.flush();
  expect(promise).toBeInstanceOf(Promise);
  expect(count).toBe(0);
  await promise;
  expect(count).toBe(3);

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenLastCalledWith(1, 2);
});

it("calls external flush", async () => {
  let resolve = () => {};
  const flush = mock(() => new Promise<void>((r) => (resolve = r)));
  const source = stream({
    push: (x: number) => x,
    flush,
  })(null);

  expectTypeOf(source).toEqualTypeOf<Stream<never, [number]>>();
  expectTypeOf(source.flush).returns.toEqualTypeOf<MaybePromise<void>>();
  source.push(0);

  expect(flush).not.toHaveBeenCalled();
  const result = source.flush();
  expect(result).toBeInstanceOf(Promise);
  expect(flush).toHaveBeenLastCalledWith([[0]]);
  expect(flush).toHaveBeenCalledTimes(1);

  expect(Promise.race([result, Promise.resolve(1)])).resolves.toBe(1);
  resolve(), await result;
  expect(Promise.race([result, Promise.resolve(1)])).resolves.toBe(undefined);

  const noop = stream({})(source);
  source.push(1);

  expectTypeOf(noop).toEqualTypeOf<Stream<never, [unknown]>>();
  noop.flush();
  expect(flush).toHaveBeenCalledTimes(2);
});

it("calls flush after all async pushes", async () => {
  let resolveFlush = () => {};
  const flush = mock(() => new Promise<void>((r) => (resolveFlush = r)));
  let resolvePush = () => {};
  const push = mock(() => new Promise<void>((r) => (resolvePush = r)));

  const source = stream({ push, flush })();

  source.push();
  expect(flush).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();

  const result = source.flush();
  expect(push).toHaveBeenCalledTimes(1);
  expect(flush).not.toHaveBeenCalled();

  expect(await Promise.race([result, Promise.resolve(1)])).toBe(1);
  expect(push).toHaveBeenCalledTimes(1);
  expect(flush).not.toHaveBeenCalled();

  await new Promise((r) => setTimeout(r));
  expect(flush).not.toHaveBeenCalled();

  resolvePush();
  await new Promise((r) => setTimeout(r));
  expect(push).toHaveBeenCalledTimes(1);
  expect(flush).toHaveBeenCalledTimes(1);

  expect(await Promise.race([result, Promise.resolve(1)])).toBe(1);
  expect(push).toHaveBeenCalledTimes(1);
  expect(flush).toHaveBeenCalledTimes(1);

  resolveFlush();
  expect(push).toHaveBeenCalledTimes(1);
  expect(flush).toHaveBeenCalledTimes(1);

  expect(await result).toBe(undefined);
  expect(push).toHaveBeenCalledTimes(1);
  expect(flush).toHaveBeenCalledTimes(1);
});

it("calls flush after all downstream pushes", async () => {
  let resolveFlush = () => {};
  const flush = mock(() => new Promise<void>((r) => (resolveFlush = r)));
  let resolvePush = () => {};
  const push = mock(
    (x) => new Promise<void>((r) => (resolvePush = () => r(x))),
  );

  const source = stream({ flush })(null);
  const sink = stream({ push, flush: () => {} })(source);

  source.push(42);
  expect(flush).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();

  await new Promise((r) => setTimeout(r));
  expect(push).toHaveBeenLastCalledWith(42);
  expect(flush).not.toHaveBeenCalled();

  await new Promise((r) => setTimeout(r));
  expect(flush).not.toHaveBeenCalled();

  resolvePush();
  await new Promise((r) => setTimeout(r));
  expect(push).toHaveBeenCalledTimes(1);
  expect(flush).toHaveBeenCalledTimes(1);
  await new Promise((r) => setTimeout(r));
  expect(push).toHaveBeenCalledTimes(1);
  expect(flush).toHaveBeenCalledTimes(1);

  const result = sink.flush();
  expect(result).toBeInstanceOf(Promise);
  expect(await Promise.race([result, Promise.resolve(1)])).toBe(1);
  resolveFlush(), await result;
  expect(await Promise.race([result, Promise.resolve(1)])).toBe(undefined);
});

it("handles pulling with downstream flushes", () => {
  let count = 0;
  const source = stream({
    flush: (x) => x.forEach(([y]) => (count += y)),
    pull: () => count,
  })(null);

  source.push(1);
  source.push(2);
  expect(source.pull()).toBe(3);

  // Add a downstream
  stream({})(source);

  source.push(3);
  expect(source.pull()).toBe(6);
});

it("merges partial entities correctly", () => {
  const source = stream({ push: (x?: number, y?: number) => [x, y] })(
    null,
    null,
  );
  const spy = mock();
  source.connect(spy);
  source.push(1, undefined);
  source.push(undefined, 2);
  source.flush();

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenLastCalledWith([1, 2]);
});

it("calls all downstreams even if one throws", () => {
  const source = stream({
    push: (x: number) => x,
  })(null);

  const spy1 = mock(() => {
    throw new Error("error");
  });
  const spy2 = mock();

  source.connect(spy1);
  source.connect(spy2);

  source.push(42);
  const consoleErrorMock = spyOn(console, "error").mockImplementation(() => {});
  source.flush();
  expect(consoleErrorMock).toHaveBeenCalledTimes(1);
  consoleErrorMock.mockRestore();

  expect(spy1).toHaveBeenCalledTimes(1);
  expect(spy2).toHaveBeenCalledTimes(1);
});

it("flushes async with async downstreams", async () => {
  const spy = mock(async (_) => {});

  const source = stream({ push: (x: number) => x })(null);
  expectTypeOf(source.flush).returns.toEqualTypeOf<MaybePromise<void>>();

  expect(source.flush()).toBe(undefined);
  source.push(42);
  expect(source.flush()).toBe(undefined);

  const view = stream({ flush: spy })(source);
  expectTypeOf(view.flush).returns.toEqualTypeOf<MaybePromise<void>>();

  expect(source.flush()).toBe(undefined);
  source.push(42);
  expect(source.flush()).toBeInstanceOf(Promise);
  await source.flush();

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenLastCalledWith([[42]]);

  expect(view.flush()).toBe(undefined);
  source.push(42);
  expect(view.flush()).toBeInstanceOf(Promise);
});

it("works with custom compression", async () => {
  const push = mock((x: number) => x);
  const source = stream({
    push,
    compress: ([numbers]) => [[numbers.reduce((a, b) => a + b)]],
  })(null);

  source.push(42);
  source.flush();
  expect(push).toHaveBeenLastCalledWith(42);

  source.push(42);
  source.push(5);
  source.flush();
  expect(push).toHaveBeenLastCalledWith(47);
});
