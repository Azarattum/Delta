import { expect, it, mock } from "bun:test";
import { Stream, stream } from "./stream";
import "./type-test";

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
