import { zero, type ZSet } from "../datastructure/zset";
import { it, mock, expect } from "bun:test";
import { sink, stream } from "..";

it("sinks with long initial pull", async () => {
  let resolvePull = (_: ZSet<number>) => {};
  const pull = mock(() => new Promise<ZSet<number>>((r) => (resolvePull = r)));

  const source = stream({ pull })(null);
  const view = sink(source);

  const loading = view.preload();
  expect(await Promise.race([loading, Promise.resolve(1)])).toBe(1);
  view.push([[1], [-1] as any]);

  resolvePull([[1], [1] as any]);
  await new Promise((r) => setTimeout(r));
  expect(await Promise.race([loading, Promise.resolve(1)])).toBe(undefined);

  expect(view.pull()).toEqual([[], [] as any]);
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
  const source = stream({
    push: (x: ZSet<number>) => x,
    pull: () => zero<number>(),
  })(null);

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
