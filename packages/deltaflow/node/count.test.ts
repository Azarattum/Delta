import { create, remove, type ZSet } from "../datastructure/zset";
import { it, expect, expectTypeOf } from "bun:test";
import { shape } from "../datastructure/shape";
import { sqlite } from "./source/sqlite";
import { stream } from "../stream";
import SQLite from "bun:sqlite";
import { count } from "./count";

const idShape = shape((t) => ({ id: t(t.INT, t.PRIMARY) }));
const [add, del] = [create(idShape), remove(idShape)];

it("pulls total count from upstream", async () => {
  const db = new SQLite(":memory:");
  const items = sqlite(db, "items", idShape, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  const total = count(items);

  expect(total.pull()).toBe(3);
});

it("pulls total count from empty source", () => {
  const db = new SQLite(":memory:");
  const items = sqlite(db, "items_empty", idShape);

  const total = count(items);
  expect(total.pull()).toBe(0);
});

it("tracks count incrementally on push", () => {
  const db = new SQLite(":memory:");
  const items = sqlite(db, "items", idShape, [{ id: 1 }, { id: 2 }]);

  const total = count(items);
  const updates: number[] = [];
  total.subscribe((n) => updates.push(n));

  // Add items
  items.push([[{ id: 3 }, { id: 4 }], [add, add], idShape]);
  items.flush();
  expect(updates).toEqual([2, 4]);

  // Remove an item
  items.push([[{ id: 1 }], [del]]);
  items.flush();
  expect(updates).toEqual([2, 4, 3]);
});

it("handles mixed adds and removes in a single delta", () => {
  const db = new SQLite(":memory:");
  const items = sqlite(db, "items", idShape, [{ id: 1 }, { id: 2 }, { id: 3 }]);

  const total = count(items);
  const updates: number[] = [];
  total.subscribe((n) => updates.push(n));

  // +4, +5, -1 => net +1
  items.push([[{ id: 1 }, { id: 4 }, { id: 5 }], [del, add, add], idShape]);
  items.flush();
  expect(updates).toEqual([3, 4]);
});

it("tracks count without prior pull (lazy init)", () => {
  const db = new SQLite(":memory:");
  const items = sqlite(db, "items", idShape, [{ id: 1 }, { id: 2 }]);

  const total = count(items);
  const updates: number[] = [];
  total.connect((n) => updates.push(n));

  // Push without ever pulling — should auto-init
  items.push([[{ id: 3 }], [add], idShape]);
  items.flush();
  expect(updates).toEqual([3]);

  // Verify pull reflects the same
  expect(total.pull()).toBe(3);
});

it("reaches zero and goes back up", () => {
  const db = new SQLite(":memory:");
  const items = sqlite(db, "items", idShape, [{ id: 1 }]);

  const total = count(items);
  const updates: number[] = [];
  total.subscribe((n) => updates.push(n));

  items.push([[{ id: 1 }], [del]]);
  items.flush();
  expect(updates).toEqual([1, 0]);

  items.push([[{ id: 2 }, { id: 3 }], [add, add], idShape]);
  items.flush();
  expect(updates).toEqual([1, 0, 2]);
});

it("returns total count via pull option", () => {
  const db = new SQLite(":memory:");
  const items = sqlite(db, "items", idShape, [
    { id: 1 },
    { id: 2 },
    { id: 3 },
    { id: 4 },
    { id: 5 },
  ]);

  const total = { out: 0 };
  const [data] = items.pull({ cursor: { offset: 1, count: 2 }, total });
  expect(data).toEqual([{ id: 2 }, { id: 3 }]);
  expect(total.out).toBe(5);
});

it("returns total count with empty result", () => {
  const db = new SQLite(":memory:");
  const items = sqlite(db, "items", idShape, [{ id: 1 }, { id: 2 }]);

  const total = { out: 0 };
  items.pull({ cursor: { offset: 10, count: 5 }, total });
  expect(total.out).toBe(2);
});

it("returns total count without cursor", () => {
  const db = new SQLite(":memory:");
  const items = sqlite(db, "items", idShape, [{ id: 1 }, { id: 2 }, { id: 3 }]);

  const total = { out: 0 };
  items.pull({ total });
  expect(total.out).toBe(3);
});

it("returns total count with filter", () => {
  const db = new SQLite(":memory:");
  const itemShape = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    x: t.INT,
  }));
  const items = sqlite(db, "items", itemShape, [
    { id: 1, x: 10 },
    { id: 2, x: 20 },
    { id: 3, x: 10 },
    { id: 4, x: 30 },
  ]);

  const total = { out: 0 };
  items.pull({
    filter: [{ keys: [["x"]], items: [{ x: 10 } as any], exclude: false }],
    total,
  });
  expect(total.out).toBe(2);
});

it("returns zero for empty table", () => {
  const db = new SQLite(":memory:");
  const items = sqlite(db, "items_empty", idShape);

  const total = { out: 0 };
  items.pull({ total });
  expect(total.out).toBe(0);
});

it("works with sync and async upstreams", async () => {
  const async = stream({ pull: async () => [[], []] as ZSet<{}> })(null);
  const sync = stream({ pull: () => [[], []] as ZSet<{}> })(null);

  const total = count(async);
  expectTypeOf(total.pull()).toEqualTypeOf<number | Promise<number>>();
  expect(total.pull()).toBeInstanceOf(Promise);

  const total2 = count(sync);
  expectTypeOf(total2.pull()).toEqualTypeOf<number>();
  expect(total2.pull()).toBeTypeOf("number");
});
