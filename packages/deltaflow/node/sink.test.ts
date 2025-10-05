import type { ZSet } from "../datastructure/zset";
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
