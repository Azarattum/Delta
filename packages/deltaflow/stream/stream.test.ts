import { expect, expectTypeOf, it, mock, spyOn } from "bun:test";
import type { Stream, StreamOutput } from "./stream";
import type { MaybePromise } from "./promise";
import { stream } from "./stream";

it("streams lazily", () => {
  const spyPull = mock(() => 123);
  const source = stream({ pull: spyPull, push: () => 0 })();
  const noop = stream<number>({});
  const node = noop(source);

  expect(spyPull).not.toHaveBeenCalled();
  node.pull();
  expect(spyPull).toHaveBeenCalledTimes(1);
});

it("initializes on first downstream and disposes on last downstream", () => {
  const dispose1 = mock();
  const dispose2 = mock();
  let count = 0;

  const source = stream({
    init: () => (++count === 1 ? dispose1 : dispose2),
    push: (x: number) => x,
  })(null);

  const disconnect1 = source.connect(mock());
  const disconnect2 = source.connect(mock());

  expect(count).toBe(1);
  expect(dispose1).not.toHaveBeenCalled();

  disconnect1();
  expect(dispose1).not.toHaveBeenCalled();

  disconnect2();
  expect(dispose1).toHaveBeenCalledTimes(1);

  const disconnect3 = source.connect(mock());
  expect(count).toBe(2);

  disconnect3();
  expect(dispose2).toHaveBeenCalledTimes(1);
});

it("initializes before first subscribe pull", () => {
  let count = 0;
  const dispose = mock();
  const source = stream({
    init: () => {
      count = 42;
      return dispose;
    },
    pull: () => count,
  })(null);

  const spy = mock();
  const disconnect = source.subscribe(spy);

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenLastCalledWith(42);

  disconnect();
  expect(dispose).toHaveBeenCalledTimes(1);
});

it("disposes init with using", () => {
  const dispose = mock();

  {
    using source = stream({
      init: () => dispose,
      push: (x: number) => x,
    })(null);
    source.connect(mock());
  }

  expect(dispose).toHaveBeenCalledTimes(1);
});

it("disconnects upstreams with using", () => {
  const source = stream({ push: (x: number) => x })(null);
  const spy = mock();

  {
    using view = stream({ push: (x: number) => x })(source);
    view.connect(spy);
  }

  source.push(42);
  source.flush();
  expect(spy).not.toHaveBeenCalled();
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

  const cached = stream({
    push: (x: number) => x,
    pull: (): number | Promise<number> => 42,
  })(asyncSource);

  expectTypeOf(cached.pull()).toEqualTypeOf<number | Promise<number>>();

  // @ts-expect-error pull must return the same value family as push.
  stream({ push: () => 1, pull: () => "bad" })(null);
});

it("allows explicit pulls to use different downstream options", () => {
  type UpstreamPull = { cursor: number };
  type DownstreamPull = { version: number };

  const upstream = stream({
    push: (x: number) => x,
    pull: (_options?: UpstreamPull) => 1,
  })(null);

  const withExplicitPull = stream({
    push: (x: number) => x,
    pull: (_options?: DownstreamPull) => upstream.pull({ cursor: 1 }),
  })(upstream);

  expect(withExplicitPull.pull({ version: 1 })).toBe(1);
  expectTypeOf(withExplicitPull.pull).returns.toEqualTypeOf<number>();
});

it("batches changes to a microtask", async () => {
  const source = stream({
    push: (x: number) => x!,
  })(null);

  let count = 0;
  const sink = stream({
    push: (x: number) => (count += x),
    pull: () => count,
  })(source).eager();

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
    const joined = stream({ push: spy })(source1, source2).eager();

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
    const joined = stream({ push: spy })(source1, source2).eager();

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
  })(source).eager();

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
  })(source1, source2).eager();

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
  const flush = mock((_) => new Promise<void>((r) => (resolve = r)));
  const source = stream({
    push: (x: number) => x,
    flush: (x) => () => flush(x),
  })(null);

  expectTypeOf(source).toEqualTypeOf<Stream<never, [number]>>(); // TODO: why is this never, though?..
  expectTypeOf(source.flush).returns.toEqualTypeOf<MaybePromise<void>>();
  source.push(0);

  expect(flush).not.toHaveBeenCalled();
  const result = source.flush();
  expect(result).toBeInstanceOf(Promise);
  expect(flush).toHaveBeenLastCalledWith([0]);
  expect(flush).toHaveBeenCalledTimes(1);

  expect(Promise.race([result, Promise.resolve(1)])).resolves.toBe(1);
  resolve(), await result;
  expect(Promise.race([result, Promise.resolve(1)])).resolves.toBe(undefined);

  const noop = stream({})(source).eager();
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

  const source = stream({ push, flush: () => flush })();

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

  const source = stream({ flush: () => flush })(null);
  const sink = stream({ push, flush: () => () => {} })(source).eager();

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
    flush: (values) => {
      const total = values.reduce((sum, x) => sum + x, 0);
      return () => void (count += total);
    },
    pull: () => count,
  })(null);

  source.push(1);
  source.push(2);
  expect(source.pull()).toBe(3);

  // Add a downstream
  stream({})(source).eager();

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

  const view = stream({ flush: (x) => () => spy(x) })(source).eager();

  expectTypeOf(view.flush).returns.toEqualTypeOf<MaybePromise<void>>();

  expect(source.flush()).toBe(undefined);
  source.push(42);
  expect(source.flush()).toBeInstanceOf(Promise);
  await source.flush();

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenLastCalledWith([42]);

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

it("extends streams with extra API", () => {
  let count = 0;
  const source = stream({
    pull: () => count,
    extensions: {
      get count() {
        return count;
      },
    },
  })(null);

  expectTypeOf(source).toEqualTypeOf<
    Stream<number, [number]> & { readonly count: number }
  >();

  expect(source.count).toBe(0);
  count = 42;
  expect(source.count).toBe(42);
  expect(source.pull()).toBe(42);
});

it("emits committed state and respects disconnection during asynchronous commits", async () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  let value = 0;
  const node = stream({
    push: (x: number) => x,
    pull: () => value,
    flush(values, output) {
      output.preventDefault();
      return () =>
        promise.then(() => {
          value = values.at(-1)!;
          output.emit(value);
        });
    },
  })(null);

  const state = mock();
  node.connect(state);
  const dropped = mock();
  const disconnect = node.connect(dropped);

  node.push(1);
  const flushing = node.flush();
  expect(state).not.toHaveBeenCalled();
  expect(value).toBe(0);
  disconnect();

  resolve();
  await flushing;
  expect(state).toHaveBeenCalledTimes(1);
  expect(state).toHaveBeenCalledWith(1);
  expect(dropped).not.toHaveBeenCalled();
});

it.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])(
  "compresses downstream only (async upstream: %s, downstream: %s)",
  async (asyncUpstream, asyncDownstream) => {
    let total = 0;
    const pull = mock(() => total);

    const node = stream({
      push: (x: number) => (asyncUpstream ? Promise.resolve(x) : x),
      pull,
      flush: (values) => {
        const sum = values.reduce((sum, x) => sum + x, 0);
        return () => void (total += sum);
      },
    })(null);

    const delta = mock((x: number) => {
      expect(total).toBe(0);
      return asyncDownstream ? Promise.resolve(x) : x;
    });

    const middle = stream<number>({})(node);
    stream({
      push: delta,
      compress: ([changes]) => [[changes.reduce((acc, x) => acc + x, 0)]],
    })(middle).eager();
    const state = mock();
    node.subscribe(state);
    expect(state.mock.calls).toEqual([[0]]);

    node.push(1);
    node.push(2);
    expect(delta).not.toHaveBeenCalled();
    expect(state.mock.calls).toEqual([[0]]);

    const flushing = node.flush();
    expect(flushing instanceof Promise).toBe(asyncUpstream || asyncDownstream);
    await flushing;

    expect(delta.mock.calls).toEqual([[3]]);
    expect(state.mock.calls).toEqual([[0], [1], [2]]);
    expect(pull).toHaveBeenCalledTimes(1);
    expect(total).toBe(3);
  },
);

it("propagates a ready branch while another branch is pending", async () => {
  const blocked = Promise.withResolvers<number>();
  const ready = Promise.withResolvers<number>();
  const commit = mock();

  using source = stream<number>({})(null);
  using slow = stream({
    push: (_x: number) => blocked.promise,
    flush: () => commit,
  })(source).eager();
  using fast = stream({ push: async (x: number) => x })(source);
  using downstream = stream<number>({})(fast);
  downstream.connect(ready.resolve);

  source.push(1);
  const flushing = slow.flush();
  expect(await ready.promise).toBe(1);
  expect(commit).not.toHaveBeenCalled();

  blocked.resolve(1);
  await flushing;
  expect(commit).toHaveBeenCalledTimes(1);
});

it("cancels forwarding for one batch without cancelling its commit", () => {
  let total = 0;
  using node = stream<number>({
    flush([value], output) {
      if (value < 0) output.preventDefault();
      return () => void (total += value);
    },
  })(null);
  const spy = mock();
  node.connect(spy);

  node.push(-2);
  expect(node.flush()).toBe(undefined);
  expect(spy).not.toHaveBeenCalled();
  expect(total).toBe(-2);

  node.push(3);
  node.flush();
  expect(spy.mock.calls).toEqual([[3]]);
  expect(total).toBe(1);
});

it("replaces a batch with multiple outputs without processing them again", () => {
  const push = mock((x: number) => x * 2);
  const commit = mock();

  using node = stream({
    push,
    flush([a, b], output) {
      output.preventDefault();
      output.emit(a + b);
      output.emit((a + b) * 10);
      return commit;
    },
  })(null);
  const receive = mock();
  node.connect(receive);

  node.push(1);
  node.push(2);
  expect(node.flush()).toBe(undefined);
  expect(push.mock.calls).toEqual([[1], [2]]);
  expect(receive.mock.calls).toEqual([[6], [60]]);
  expect(commit).toHaveBeenCalledTimes(1);
});

it("preserves default forwarding unless explicitly prevented", () => {
  using node = stream<number>({
    flush([value], output) {
      expectTypeOf(output).toEqualTypeOf<StreamOutput<number>>();
      output.emit(value * 10);
    },
  })(null);
  const receive = mock();
  node.connect(receive);

  node.push(2);
  node.flush();
  expect(receive.mock.calls).toEqual([[20], [2]]);
});

it("waits for outputs emitted by an asynchronous commit", async () => {
  const events: string[] = [];
  using node = stream<number>({
    flush([value], output) {
      output.preventDefault();
      return async () => {
        await Promise.resolve();
        events.push("commit");
        output.emit(value);
        events.push("emitted");
      };
    },
  })(null);
  node.connect(() => events.push("output"));

  const commit = mock();
  using downstream = stream({
    push: async (x: number) => {
      events.push("push");
      await Promise.resolve();
      return x;
    },
    flush: () => commit,
  })(node);
  const spy = mock();
  downstream.connect(spy);

  node.push(8);
  const flushing = node.flush();
  expect(flushing).toBeInstanceOf(Promise);
  expect(spy).not.toHaveBeenCalled();

  await flushing;
  expect(events).toEqual(["commit", "output", "emitted", "push"]);
  expect(spy.mock.calls).toEqual([[8]]);
  expect(commit).toHaveBeenCalledTimes(1);
});

it("batches deferred outputs from multiple upstreams before joining", () => {
  using source = stream<number>({})(null);
  const defer = stream<number>({
    flush(values, output) {
      output.preventDefault();
      return () => values.forEach(output.emit);
    },
  });

  using joined = stream({
    push: (a?: number, b?: number) => [a, b],
  })(defer(source), defer(source));

  const receive = mock();
  joined.connect(receive);

  source.push(1);
  source.push(2);
  expect(source.flush()).toBe(undefined);
  expect(receive.mock.calls).toEqual([[[1, 1]], [[2, 2]]]);
});

it("disconnects retained outputs on disposal", () => {
  let output: StreamOutput<number>;

  const node = stream<number>({
    flush: (_, controller) => {
      output = controller;
    },
  })(null);

  node.push(1);
  node.flush();

  const spy = mock();
  node.connect(spy);

  node[Symbol.dispose]();

  output!.emit(2);
  expect(spy).not.toHaveBeenCalled();
});
