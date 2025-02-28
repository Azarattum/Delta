import { expect, it, mock } from "bun:test";
import { type Stream, stream } from "./stream";
import "typotest";

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

  expect(asyncSource).toBeOfType<Stream<Promise<number>, [number]>>();
  expect(syncSource).toBeOfType<Stream<number, [number]>>();

  const spy = mock();
  asyncSource.connect(spy);
  asyncSource.push(5);
  asyncSource.flush();
  expect(spy).toHaveBeenLastCalledWith(5);

  expect(asyncSource.pull()).toBeInstanceOf(Promise);
  expect(asyncSource.pull()).toBeOfType<Promise<number>>();

  const single = stream({ push: (x: number) => x.toString() });
  const multiple = stream({
    push: (a?: number, b?: number) => ((a || 0) + (b || 0)).toString(),
  });

  {
    const fromAsync = single(asyncSource);
    expect(fromAsync).toBeOfType<Stream<Promise<string>, [number]>>();
    expect(fromAsync.pull()).toBeInstanceOf(Promise);
    expect(fromAsync.pull()).resolves.toBe("42");
    expect(fromAsync.pull()).toBeOfType<Promise<string>>();

    const fromSync = single(syncSource);
    expect(fromSync).toBeOfType<Stream<string, [number]>>();
    expect(fromSync.pull()).toBe("42");
    expect(fromSync.pull()).toBeOfType<string>();
  }
  {
    const fromAsync = multiple(asyncSource, asyncSource);
    expect(fromAsync).toBeOfType<Stream<Promise<string>, [number, number]>>();
    expect(fromAsync.pull()).toBeInstanceOf(Promise);
    expect(fromAsync.pull()).resolves.toBe("84");
    expect(fromAsync.pull()).toBeOfType<Promise<string>>();

    const fromSync = multiple(syncSource, syncSource);
    expect(fromSync).toBeOfType<Stream<string, [number, number]>>();
    expect(fromSync.pull()).toBe("84");
    expect(fromSync.pull()).toBeOfType<string>();

    const fromBoth = multiple(syncSource, asyncSource);
    expect(fromBoth).toBeOfType<Stream<Promise<string>, [number, number]>>();
    expect(fromBoth.pull()).toBeInstanceOf(Promise);
    expect(fromBoth.pull()).resolves.toBe("84");
    expect(fromBoth.pull()).toBeOfType<Promise<string>>();
  }

  const syncify = stream({
    push: (x: number) => x.toString(),
    pull: () => "1337",
  });

  {
    const fromAsync = syncify(asyncSource);
    expect(fromAsync).toBeOfType<Stream<string, [number]>>();
    expect(fromAsync.pull()).toBe("1337");
    expect(fromAsync.pull()).toBeOfType<string>();
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

  expect(source1).toBeOfType<Stream<number, [number]>>();

  {
    const spy = mock((_1?: number, _2?: number) => 0 as const);
    const joined = stream({ push: spy })(source1, source2);

    expect(joined.flush).toHaveReturnTypeOf<void>();
    expect(joined.pull).toHaveReturnTypeOf<0>();

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

    expect(joined.flush).toHaveReturnTypeOf<Promise<void>>();
    expect(joined.pull).toHaveReturnTypeOf<Promise<0>>();

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

  expect(source).toBeOfType<Stream<never, [number], Promise<void>>>();

  let count = 0;
  const view = stream({
    push: (x: number) => (count += x),
    pull: () => count,
  })(source);

  expect(view).toBeOfType<Stream<number, [number], Promise<void>>>();

  expect(source.pull).toHaveReturnTypeOf<never>();
  expect(source.flush).toHaveReturnTypeOf<Promise<void>>();
  expect(view.pull).toHaveReturnTypeOf<number>();
  expect(view.flush).toHaveReturnTypeOf<Promise<void>>();
  expect(source.push).toHaveReturnTypeOf<void>();
  expect(view.push).toHaveReturnTypeOf<void>();

  source.push(1);
  expect(view.pull()).toBe(0);
  expect(view.isDirty).toBe(true);
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

  expect(joined.pull).toHaveReturnTypeOf<number>();
  expect(joined.pull()).toBe(0);
  expect(count).toBe(0);

  source1.push(1);
  source2.push(2);
  expect(joined.flush).toHaveReturnTypeOf<Promise<void>>();
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

  expect(source).toBeOfType<Stream<never, [number], Promise<void>>>();
  expect(source.flush).toHaveReturnTypeOf<Promise<void>>();

  expect(flush).not.toHaveBeenCalled();
  const result = source.flush();
  expect(result).toBeInstanceOf(Promise);
  expect(flush).toHaveBeenLastCalledWith([]);
  expect(flush).toHaveBeenCalledTimes(1);

  expect(Promise.race([result, Promise.resolve(1)])).resolves.toBe(1);
  resolve(), await result;
  expect(Promise.race([result, Promise.resolve(1)])).resolves.toBe(undefined);

  const noop = stream({})(source);

  expect(noop).toBeOfType<Stream<unknown, [unknown], Promise<void>>>();
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

  await Promise.resolve().then(() => Promise.resolve());
  expect(flush).not.toHaveBeenCalled();

  resolvePush();
  await Promise.resolve().then(() => Promise.resolve());
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
  expect(flush).toHaveBeenCalledTimes(2);
});
