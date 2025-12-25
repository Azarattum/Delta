import { beforeEach, describe, expect, it, vi } from "bun:test";
import SQLite from "bun:sqlite";
import { shape } from "../datastructure/shape";
import { sqlite } from "./source/sqlite";
import { limit, range } from "./range";

const idShape = shape((t) => ({ id: t(t.INT, t.PRIMARY) }));
const ids = (...x: number[]) => x.map((id) => ({ id }));

describe("limits lower bound with", async () => {
  let items: ReturnType<typeof sqlite<{ id: number }>>;
  let delta: ReturnType<
    typeof vi.fn<(data: { id: number }[], meta: number[]) => void>
  >;

  beforeEach(() => {
    const db = new SQLite(":memory:");
    items = sqlite(db, "items", idShape, ids(1, 2, 3, 4, 5, 6));
    const view = range(items, limit(10, 2));
    expect(view.pull()[0]).toEqual(ids(3, 4, 5, 6));

    delta = vi.fn();
    view.connect((x) => {
      // console.log(
      //   "final delta:",
      //   x[0].map((n, i) => n.id * Math.sign(x[1][i])),
      // );
      delta(x[0], x[1]);
    });
  });

  it("adds (no interleaf)", async () => {
    await items.push([ids(1.5), [1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2), [1]);
  });

  it("adds (interleaf)", async () => {
    await items.push([ids(2.5), [1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2.5), [1]);
  });

  it("adds (mixed interleaf)", async () => {
    await items.push([ids(1.5, 2.5), [1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2, 2.5), [1, 1]);
  });

  it("removes (no interleaf)", async () => {
    await items.push([ids(1), [-1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [-1]);
  });

  it("removes (interleaf)", async () => {
    await items.push([ids(3), [-1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [-1]);
  });

  it("removes (mixed interleaf)", async () => {
    await items.push([ids(2, 3), [-1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 4), [-1, -1]);
  });

  it("adds=removes (no interleaf)", async () => {
    await items.push([ids(1, 1.5), [-1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(), []);
  });

  it("adds=removes (interleaf)", async () => {
    await items.push([ids(2, 2.5, 3.5), [-1, 1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3.5), [1]);
  });

  it("adds>removes (no interleaf)", async () => {
    await items.push([ids(1, 1.5, 2), [-1, 1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [-1]);
  });

  it("adds>removes (interleaf)", async () => {
    await items.push([ids(1, 2, 2.5, 3.5), [-1, -1, 1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 3.5), [-1, 1]);
  });

  it("adds<removes (no interleaf)", async () => {
    await items.push([ids(0.5, 1, 1.5), [1, -1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2), [1]);
  });

  it("adds<removes (interleaf)", async () => {
    await items.push([ids(0.5, 1, 2.5), [1, -1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2.5), [1]);
  });

  it("adds<removes (interleaf 2)", async () => {
    await items.push([ids(0.5, 1, 1.5, 2.5), [1, -1, 1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2, 2.5), [1, 1]);
  });

  it("adds<removes (interleaf 3)", async () => {
    await items.push([ids(0.25, 0.5, 2), [1, 1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1), [1]);
  });

  it("updates at anchor", async () => {
    await items.push([ids(3), [0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [0]);
  });

  it("removes then updates at anchor", async () => {
    await items.push([ids(1.5, 3), [1, 0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2, 3), [1, 0]);
  });

  it("adds then updates at anchor", async () => {
    await items.push([ids(2, 3), [-1, 0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [-1]);
  });
});

describe("limits upper bound with", async () => {
  let items: ReturnType<typeof sqlite<{ id: number }>>;
  let delta: ReturnType<
    typeof vi.fn<(data: { id: number }[], meta: number[]) => void>
  >;

  beforeEach(() => {
    const db = new SQLite(":memory:");
    items = sqlite(db, "items", idShape, ids(1, 2, 3, 4, 5, 6));
    const view = range(items, limit(4, 0));
    expect(view.pull()[0]).toEqual(ids(1, 2, 3, 4));

    delta = vi.fn();
    view.connect((x) => {
      // console.log(
      //   "final delta:",
      //   x[0].map((n, i) => n.id * Math.sign(x[1][i])),
      // );
      delta(x[0], x[1]);
    });
  });

  it("adds (no interleaf)", async () => {
    await items.push([ids(4.5), [1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(), []);
  });

  it("adds (interleaf)", async () => {
    await items.push([ids(3.5), [1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3.5, 4), [1, -1]);
  });

  it("adds (mixed interleaf)", async () => {
    await items.push([ids(3.5, 4.5), [1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3.5, 4), [1, -1]);
  });

  it("removes (no interleaf)", async () => {
    await items.push([ids(5), [-1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(), []);
  });

  it("removes (interleaf)", async () => {
    await items.push([ids(4), [-1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4, 5), [-1, 1]);
  });

  it("removes (mixed interleaf)", async () => {
    await items.push([ids(4, 5), [-1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4, 6), [-1, 1]);
  });

  it("adds=removes (no interleaf)", async () => {
    await items.push([ids(1.5, 2), [1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 2), [1, -1]);
  });

  it("adds=removes (interleaf)", async () => {
    await items.push([ids(4, 4.5), [-1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4, 4.5), [-1, 1]);
  });

  it("adds=removes (mixed interleaf)", async () => {
    await items.push([ids(4, 5.5), [-1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4, 5), [-1, 1]);
  });

  it("adds>removes (no interleaf)", async () => {
    await items.push([ids(1.5, 2.5, 3), [1, 1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 2.5, 3, 4), [1, 1, -1, -1]);
  });

  it("adds<removes (no interleaf)", async () => {
    await items.push([ids(1.5, 2, 3), [1, -1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 2, 3, 5), [1, -1, -1, 1]);
  });

  it("updates at anchor", async () => {
    await items.push([ids(4), [0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4), [0]);
  });

  it("removes then updates at anchor", async () => {
    await items.push([ids(3, 4), [-1, 0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 4, 5), [-1, 0, 1]);
  });

  it("adds then updates at anchor", async () => {
    await items.push([ids(3.5, 4), [1, 0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3.5, 4), [1, -1]);
  });

  it("adds extra", async () => {
    await items.push([ids(3, 4, 5.5, 7, 8, 9), [-1, -1, 1, 1, 1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 4, 5, 5.5), [-1, -1, 1, 1]);
  });

  it("dunno", async () => {
    await items.push([ids(1.5, 3.5), [1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 4), [1, -1]);
  });
});
