import { it, mock, expect, expectTypeOf } from "bun:test";
import { sink, stream, source, shape, memory } from "..";
import { zero, type ZSet } from "../datastructure/zset";
import type { MaybePromise } from "../stream";

it("retains pushes while preload is pending", async () => {
  const { promise, resolve } = Promise.withResolvers<ZSet<number>>();
  const receive = mock();

  const source = stream({ pull: () => promise })(null);
  using view = sink(source);
  view.connect(receive);

  const loading = view.preload();
  source.push([[1], [-1]]);
  const flushing = source.flush();

  expect(loading).toBeInstanceOf(Promise);
  expect(flushing).toBeInstanceOf(Promise);
  expect(view.pull()).toEqual([[], []]);
  expect(receive).not.toHaveBeenCalled();

  resolve([[1], [1]]);
  await flushing;

  const data = await loading;
  expect(data).toEqual([[], []]);
  expect(view.pull()).toBe(data);
  expect(receive.mock.calls).toEqual([[data]]);
});

it("returns initial synchronously while preloading without broadcasting the snapshot", async () => {
  const { promise, resolve } = Promise.withResolvers<ZSet<number>>();
  const pull = mock(() => promise);

  const initial: ZSet<number> = [[0], [1]];
  using view = sink(stream({ pull })(null), initial);

  expectTypeOf(view.pull).returns.toEqualTypeOf<ZSet<number>>();
  expectTypeOf(view.preload).returns.toEqualTypeOf<
    MaybePromise<ZSet<number>>
  >();

  const receive = mock();
  view.connect(receive);
  expect(pull).not.toHaveBeenCalled();
  expect(view.pull()).toBe(initial);

  const loading = view.preload();
  expect(view.preload()).toBe(loading);
  const state = mock();
  view.subscribe(state);
  expect(state.mock.calls).toEqual([[initial]]);

  resolve([[1], [1]]);
  const data = await loading;
  expect(view.pull()).toBe(data);
  expect(view.preload()).toBe(data);
  expect(state.mock.calls).toEqual([[initial]]);
  expect(receive).not.toHaveBeenCalled();
  expect(pull).toHaveBeenCalledTimes(1);
});

it("doesn't initialize graph until loaded", () => {
  const double = mock(
    (x: ZSet<number>) => [x[0].map((n) => n * 2), x[1]] as ZSet<number>,
  );

  const source = stream({
    push: (x: ZSet<number>) => x,
    pull: () => zero<number>(),
  })(null);
  const transform = stream({ push: double })(source);
  const view = sink(transform);

  source.push([[1], [1]]);
  source.flush();
  expect(double).not.toHaveBeenCalled();

  view.preload();
  expect(double).toHaveBeenCalledTimes(1);

  source.push([[2], [1]]);
  source.flush();
  expect(double).toHaveBeenCalledTimes(2);
});

it("manages lifecycle", () => {
  const source = stream({ pull: () => zero<number>() })(null);

  const nonManaged = mock();
  const managed = mock();
  {
    const view = sink(source);
    view.preload();
    view.connect(nonManaged);
  }
  {
    using view = sink(source);
    view.preload();
    view.connect(managed);
  }

  source.push([[1], [1]]);
  source.flush();

  expect(nonManaged).toHaveBeenCalledWith([[1], [1]]);
  expect(managed).not.toHaveBeenCalled();
});

it("integrates and notifies after asynchronous propagation", async () => {
  const user = shape((t) => ({
    id: t(t.PRIMARY, t.INT),
    age: t.INT,
  }));

  const users = source(user, memory())();
  users.create({ id: 1, age: 25 }).flush();

  using view = sink(users);

  const [data] = view.pull();
  const old = data[0];
  const notify = mock();
  view.connect(notify);

  const { promise, resolve } = Promise.withResolvers<void>();
  using process = stream({
    push: async (_x: ZSet<(typeof user)["~type"]>) => {
      await promise;
      expect(old.age).toBe(25);
    },
  })(users).eager();

  users.updateUnsafe([old, { ...old, age: 26 }]);
  const flushing = process.flush();
  expect(old.age).toBe(25);
  expect(notify).not.toHaveBeenCalled();

  resolve();
  await flushing;

  expect(view.pull()[0]).toBe(data);
  expect(data[0]).toBe(old);
  expect(old.age).toBe(26);
  expect(notify).toHaveBeenCalledTimes(1);
});

it("loads silently and emits the view after pushes", () => {
  const pull = mock(() => [[1], [1]] as ZSet<number>);

  const source = stream({ pull })(null);
  using view = sink(source);

  const receive = mock();
  view.connect(receive);
  expect(pull).not.toHaveBeenCalled();

  const state = mock();
  view.subscribe(state);
  expect(state.mock.calls).toEqual([[[[1], [1]]]]);
  expect(receive).not.toHaveBeenCalled();
  expect(pull).toHaveBeenCalledTimes(1);

  source.push([[2], [1]]);
  expect(view.flush()).toBe(undefined);

  const expected = [
    [1, 2],
    [1, 1],
  ];

  expect(receive).toHaveBeenCalledTimes(1);
  expect(receive).toHaveBeenLastCalledWith(expected);
  expect(state).toHaveBeenCalledTimes(2);
  expect(state).toHaveBeenLastCalledWith(expected);
});
