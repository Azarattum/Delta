import { beforeEach, describe, expect, it, vi } from "bun:test";
import SQLite from "bun:sqlite";
import { shape } from "../datastructure/shape";
import { sqlite } from "./source/sqlite";
import { limit, range } from "./range";
import { add, distinct } from "../datastructure/zset";

const idShape = shape((t) => ({ id: t(t.INT, t.PRIMARY) }));
const ids = (...x: number[]) => x.map((id) => ({ id }));

describe("limits lower bound with", async () => {
  let items: ReturnType<typeof sqlite<{ id: number }>>;
  let delta: ReturnType<
    typeof vi.fn<(data: { id: number }[], meta: number[]) => void>
  >;

  async function expectLowerBound(id: number) {
    items.push([ids(id - 0.001), [-1], idShape]);
    await items.flush();
    expect(delta).toHaveBeenLastCalledWith(ids(id), [-1]);
  }

  beforeEach(() => {
    console.log([1, 2, "[", 3, 4, 5, 6]);
    const db = new SQLite(":memory:");
    items = sqlite(db, "items", idShape, ids(1, 2, 3, 4, 5, 6));
    const view = range(items, limit(10, 2));
    expect(view.pull()[0]).toEqual(ids(3, 4, 5, 6));

    delta = vi.fn();
    view.connect((x) => {
      console.log(
        "final delta:",
        x[0].map((n, i) => n.id * Math.sign(x[1][i])),
      );
      delta(x[0], x[1]);

      const applied = distinct(
        add([ids(3, 4, 5, 6), [1, 1, 1, 1], idShape], x),
      );
      console.log(
        "final view:",
        applied[0].map((n, i) => n.id * Math.sign(applied[1][i])),
      );
    });
  });

  it("adds (no interleaf)", async () => {
    await items.push([ids(1.5), [1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2), [1]);
    await expectLowerBound(2);
  });

  it("adds (interleaf)", async () => {
    await items.push([ids(2.5), [1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2.5), [1]);
    await expectLowerBound(2.5);
  });

  it("adds (mixed interleaf)", async () => {
    await items.push([ids(1.5, 2.5), [1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2, 2.5), [1, 1]);
    await expectLowerBound(2);
  });

  it("removes (no interleaf)", async () => {
    await items.push([ids(1), [-1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [-1]);
    await expectLowerBound(4);
  });

  it("removes (interleaf)", async () => {
    await items.push([ids(3), [-1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [-1]);
    await expectLowerBound(4);
  });

  it("removes (mixed interleaf)", async () => {
    await items.push([ids(2, 3), [-1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 4), [-1, -1]);
    await expectLowerBound(5);
  });

  it("adds=removes (no interleaf)", async () => {
    await items.push([ids(1, 1.5), [-1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(), []);
    await expectLowerBound(3);
  });

  it("adds=removes (interleaf)", async () => {
    await items.push([ids(2, 2.5, 3.5), [-1, 1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3.5), [1]);
    await expectLowerBound(3);
  });

  it("adds>removes (no interleaf)", async () => {
    await items.push([ids(1, 1.5, 2), [-1, 1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [-1]);
    await expectLowerBound(4);
  });

  it("adds>removes (interleaf)", async () => {
    await items.push([ids(1, 2, 2.5, 3.5), [-1, -1, 1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 3.5), [-1, 1]);
    await expectLowerBound(4);
  });

  it("adds<removes (no interleaf)", async () => {
    await items.push([ids(0.5, 1, 1.5), [1, -1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2), [1]);
    await expectLowerBound(2);
  });

  it("adds<removes (interleaf)", async () => {
    await items.push([ids(0.5, 1, 2.5), [1, -1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2.5), [1]);
    await expectLowerBound(2.5);
  });

  it("adds<removes (interleaf 2)", async () => {
    await items.push([ids(0.5, 1, 1.5, 2.5), [1, -1, 1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2, 2.5), [1, 1]);
    await expectLowerBound(2);
  });

  it("adds<removes (interleaf 3)", async () => {
    await items.push([ids(0.25, 0.5, 2), [1, 1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1), [1]);
    await expectLowerBound(1);
  });

  it("updates at anchor", async () => {
    await items.push([ids(3), [0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [0]);
    await expectLowerBound(3);
  });

  it("removes then updates at anchor", async () => {
    await items.push([ids(1.5, 3), [1, 0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2, 3), [1, 0]);
    await expectLowerBound(2);
  });

  it("adds then updates at anchor", async () => {
    await items.push([ids(2, 3), [-1, 0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [-1]);
    await expectLowerBound(4);
  });

  it("skips within", async () => {
    await items.push([ids(1, 2, 3.5), [-1, -1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [-1]);
    await expectLowerBound(4);
  });
});

describe("limits upper bound with", async () => {
  let items: ReturnType<typeof sqlite<{ id: number }>>;
  let delta: ReturnType<
    typeof vi.fn<(data: { id: number }[], meta: number[]) => void>
  >;

  async function expectUpperBound(id: number) {
    items.push([ids(id - 0.001), [1], idShape]);
    await items.flush();
    expect(delta).toHaveBeenLastCalledWith(ids(id - 0.001, id), [1, -1]);
  }

  beforeEach(() => {
    const db = new SQLite(":memory:");
    items = sqlite(db, "items", idShape, ids(1, 2, 3, 4, 5, 6));
    const view = range(items, limit(4, 0));
    expect(view.pull()[0]).toEqual(ids(1, 2, 3, 4));

    console.log([1, 2, 3, 4, "]", 5, 6]);
    delta = vi.fn();
    view.connect((x) => {
      console.log(
        "final delta:",
        x[0].map((n, i) => n.id * Math.sign(x[1][i])),
      );
      delta(x[0], x[1]);

      const applied = distinct(
        add([ids(1, 2, 3, 4), [1, 1, 1, 1], idShape], x),
      );
      console.log(
        "final view:",
        applied[0].map((n, i) => n.id * Math.sign(applied[1][i])),
      );
    });
  });

  it("adds (no interleaf)", async () => {
    await items.push([ids(4.5), [1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(), []);
    await expectUpperBound(4);
  });

  it("adds (interleaf)", async () => {
    await items.push([ids(3.5), [1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3.5, 4), [1, -1]);
    await expectUpperBound(3.5);
  });

  it("adds (mixed interleaf)", async () => {
    await items.push([ids(3.5, 4.5), [1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3.5, 4), [1, -1]);
    await expectUpperBound(3.5);
  });

  it("removes (no interleaf)", async () => {
    await items.push([ids(5), [-1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(), []);
    await expectUpperBound(4);
  });

  it("removes (interleaf)", async () => {
    await items.push([ids(4), [-1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4, 5), [-1, 1]);
    await expectUpperBound(5);
  });

  it("removes (mixed interleaf)", async () => {
    await items.push([ids(4, 5), [-1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4, 6), [-1, 1]);
    await expectUpperBound(6);
  });

  it("adds=removes (no interleaf)", async () => {
    await items.push([ids(1.5, 2), [1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 2), [1, -1]);
    await expectUpperBound(4);
  });

  it("adds=removes (interleaf)", async () => {
    await items.push([ids(4, 4.5), [-1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4, 4.5), [-1, 1]);
    await expectUpperBound(4.5);
  });

  it("adds=removes (mixed interleaf)", async () => {
    await items.push([ids(4, 5.5), [-1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4, 5), [-1, 1]);
    await expectUpperBound(5);
  });

  it("adds>removes (no interleaf)", async () => {
    await items.push([ids(1.5, 2.5, 3), [1, 1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 2.5, 3, 4), [1, 1, -1, -1]);
    await expectUpperBound(2.5);
  });

  it("adds<removes (no interleaf)", async () => {
    await items.push([ids(1.5, 2, 3), [1, -1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 2, 3, 5), [1, -1, -1, 1]);
    await expectUpperBound(5);
  });

  it("updates at anchor", async () => {
    await items.push([ids(4), [0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4), [0]);
    await expectUpperBound(4);
  });

  it("removes then updates at anchor", async () => {
    await items.push([ids(3, 4), [-1, 0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 4, 5), [-1, 0, 1]);
    await expectUpperBound(5);
  });

  it("adds then updates at anchor", async () => {
    await items.push([ids(3.5, 4), [1, 0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3.5, 4), [1, -1]);
    await expectUpperBound(3.5);
  });

  it("adds extra", async () => {
    await items.push([ids(3, 4, 5.5, 7, 8, 9), [-1, -1, 1, 1, 1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 4, 5, 5.5), [-1, -1, 1, 1]);
    await expectUpperBound(5.5);
  });

  it("skips within", async () => {
    await items.push([ids(1.5, 3.5), [1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 4), [1, -1]);
    await expectUpperBound(3);
  });
});
