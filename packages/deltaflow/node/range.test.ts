import { it, expect, describe, beforeEach, mock } from "bun:test";
import { create, remove, update } from "../datastructure/zset";
import { shape, range, sink, limit, sqlite } from "..";
import { source } from "./source/source";
import SQLite from "bun:sqlite";

const idShape = shape((t) => ({
  id: t(t.DOUBLE, t.PRIMARY),
  value: t.INT,
}));
const ids = (...x: number[]) => x.map((id) => ({ id, value: 0 }));
const updIds = (...x: number[]) => x.map((id) => ({ id, value: 1 }));
const [add, del, upd] = [
  create(idShape),
  remove(idShape),
  update(idShape, "value"),
];

it("initializes from the previous limit when its first change arrives", () => {
  const db = new SQLite(":memory:");
  const rows = source(idShape, sqlite(db, "rows"))();
  rows.create(...ids(0, 1, 2)).flush();

  const bounds = limit(1);
  const window = range(rows, bounds);
  const receive = mock();
  window.connect(receive);

  bounds.push([2, 0]);
  expect(bounds.flush()).toBe(undefined);

  expect(receive.mock.calls[0][0][0]).toEqual(ids(1));
  expect(window.bounds).toEqual({ lower: ids(0)[0], upper: ids(1)[0] });
  expect(bounds.pull()).toEqual([2, 0]);
});

it("limits simple queries", async () => {
  const user = shape((t) => ({ id: t(t.INT, t.PRIMARY), name: t.STRING }));

  const db = new SQLite(":memory:");
  const users = source(user, sqlite(db, "users"))();
  users.create(
    { id: 0, name: "Aron" },
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
    { id: 30, name: "Clara" },
    { id: 40, name: "Dave" },
  );

  const view = sink(range(users, limit(3, 1)));

  expect(view.pull()[0]).toEqual([
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
    { id: 30, name: "Clara" },
  ]);

  users.create({ id: 50, name: "Eve" });
  await users.flush();

  expect(view.pull()[0]).toEqual([
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
    { id: 30, name: "Clara" },
  ]);

  users.create(
    { id: 5, name: "Aron" },
    { id: 25, name: "Agatha" },
    { id: 35, name: "Dave" },
  );
  await users.flush();

  expect(view.pull()[0]).toEqual([
    { id: 5, name: "Aron" },
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
  ]);
});

it("respects limit bounds", async () => {
  const user = shape((t) => ({ id: t(t.INT, t.PRIMARY), name: t.STRING }));

  const db = new SQLite(":memory:");
  const users = source(user, sqlite(db, "users"))();
  users.create(
    { id: 0, name: "Aron" },
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
    { id: 30, name: "Clara" },
    { id: 40, name: "Dave" },
  );

  const view = sink(range(users, limit(3, 1)));
  // TODO: this `.pull` should not be necessary
  view.pull();

  users.create(
    { id: 25, name: "Agatha" },
    { id: 27, name: "Gina" },
    { id: 28, name: "Hannah" },
  );
  await users.flush();

  expect(view.pull()[0]).toEqual([
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
    { id: 25, name: "Agatha" },
  ]);

  users.create({ id: 28, name: "Hannah" });
  await users.flush();

  expect(view.pull()[0]).toEqual([
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
    { id: 25, name: "Agatha" },
  ]);
});

it("moves window dynamically", async () => {
  const user = shape((t) => ({ id: t(t.INT, t.PRIMARY), name: t.STRING }));

  const db = new SQLite(":memory:");
  const users = source(user, sqlite(db, "users"))();
  users.create(
    { id: 0, name: "Aron" },
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
    { id: 30, name: "Clara" },
    { id: 40, name: "Dave" },
    { id: 50, name: "Eve" },
  );

  const window = limit(3, 1);
  const view = sink(range(users, window));

  expect(view.pull()[0]).toEqual([
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
    { id: 30, name: "Clara" },
  ]);

  window.push([3, 2]);

  expect(view.pull()[0]).toEqual([
    { id: 20, name: "Bob" },
    { id: 30, name: "Clara" },
    { id: 40, name: "Dave" },
  ]);

  window.push([3, 3]);

  expect(view.pull()[0]).toEqual([
    { id: 30, name: "Clara" },
    { id: 40, name: "Dave" },
    { id: 50, name: "Eve" },
  ]);

  window.push([3, 4]);

  expect(view.pull()[0]).toEqual([
    { id: 40, name: "Dave" },
    { id: 50, name: "Eve" },
  ]);

  window.push([3, 5]);

  expect(view.pull()[0]).toEqual([{ id: 50, name: "Eve" }]);

  window.push([3, 6]);

  expect(view.pull()[0]).toEqual([]);
});

it("can push without pulling", async () => {
  const user = shape((t) => ({ id: t(t.INT, t.PRIMARY), name: t.STRING }));

  const db = new SQLite(":memory:");
  const users = source(user, sqlite(db, "users"))();
  users.create(
    { id: 0, name: "Aron" },
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
    { id: 30, name: "Clara" },
    { id: 40, name: "Dave" },
    { id: 50, name: "Eve" },
  );

  const window = limit(3, 1);
  const view = sink(range(users, window));

  window.push([3, 2]);
  users.create({ id: 35, name: "Eve" });

  expect(view.pull()[0]).toEqual([
    { id: 20, name: "Bob" },
    { id: 30, name: "Clara" },
    { id: 35, name: "Eve" },
  ]);
});

describe.each([
  [
    "add with top overflow",
    [
      { id: 5, name: "Agatha" },
      { id: 11, name: "Gina" },
    ],
    [1, 1],
    [
      { id: 5, name: "Agatha" },
      { id: 10, name: "Alice" },
      { id: 11, name: "Gina" },
    ],
  ],
  [
    "delete with top overflow",
    [
      { id: 0, name: "Aron" },
      { id: 20, name: "Bob" },
    ],
    [-1, -1],
    [
      { id: 30, name: "Clara" },
      { id: 40, name: "Dave" },
      { id: 50, name: "Eve" },
    ],
  ],

  [
    "add in range",
    [
      { id: 11, name: "Agatha" },
      { id: 12, name: "Hannah" },
    ],
    [1, 1],
    [
      { id: 10, name: "Alice" },
      { id: 11, name: "Agatha" },
      { id: 12, name: "Hannah" },
    ],
  ],
  [
    "delete in range",
    [
      { id: 20, name: "Bob" },
      { id: 30, name: "Clara" },
    ],
    [-1, -1],
    [
      { id: 10, name: "Alice" },
      { id: 40, name: "Dave" },
      { id: 50, name: "Eve" },
    ],
  ],
  [
    "add with bottom overflow",
    [
      { id: 21, name: "Agatha" },
      { id: 22, name: "Hannah" },
    ],
    [1, 1],
    [
      { id: 10, name: "Alice" },
      { id: 20, name: "Bob" },
      { id: 21, name: "Agatha" },
    ],
  ],
  [
    "delete with bottom overflow",
    [
      { id: 20, name: "Bob" },
      { id: 40, name: "Dave" },
    ],
    [-1, -1],
    [
      { id: 10, name: "Alice" },
      { id: 30, name: "Clara" },
      { id: 50, name: "Eve" },
    ],
  ],
  [
    "adds and deletes with bottom overflow",
    [
      { id: 20, name: "Bob" },
      { id: 45, name: "Rob" },
    ],
    [-1, 1],
    [
      { id: 10, name: "Alice" },
      { id: 30, name: "Clara" },
      { id: 40, name: "Dave" },
    ],
  ],
])("cuts %s", async (_, data, meta, expected) => {
  const user = shape((t) => ({ id: t(t.INT, t.PRIMARY), name: t.STRING }));

  it.each([3, 2, 1, 0])("with limit %d", async (i) => {
    const db = new SQLite(":memory:");
    const users = source(user, sqlite(db, "users"))();
    users.create(
      { id: 0, name: "Aron" },
      { id: 10, name: "Alice" },
      { id: 20, name: "Bob" },
      { id: 30, name: "Clara" },
      { id: 40, name: "Dave" },
      { id: 50, name: "Eve" },
    );

    const view = sink(range(users, limit(i, 1)));
    expect(view.pull()[0]).toEqual(
      [
        { id: 10, name: "Alice" },
        { id: 20, name: "Bob" },
        { id: 30, name: "Clara" },
      ].slice(0, i),
    );

    data.forEach((x, i) => {
      if (meta[i] > 0) users.create(structuredClone(x));
      else if (meta[i] < 0) users.delete(structuredClone(x));
    });
    await users.flush();
    expect(view.pull()[0]).toEqual(expected.slice(0, i));
  });
});

describe("limits lower bound with", async () => {
  let items: ReturnType<typeof lowerBoundFixture>["items"];
  let view: ReturnType<typeof lowerBoundFixture>["view"];
  let delta: ReturnType<typeof lowerBoundFixture>["delta"];

  beforeEach(() => {
    ({ items, view, delta } = lowerBoundFixture());
    expect(view.pull()[0]).toEqual(ids(3, 4, 5, 6));
  });

  function lowerBoundFixture() {
    const db = new SQLite(":memory:");
    const items = source(idShape, sqlite(db, "items"))();
    items.create(...ids(1, 2, 3, 4, 5, 6));
    const view = range(items, limit(10, 2));
    const delta = mock<(data: { id: number }[], meta: number[]) => void>();
    view.connect((x) => delta(x[0], x[1]));
    return { items, view, delta };
  }

  it("adds (no interleaf)", async () => {
    await items.push([ids(1.5), [add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2), [add]);
    expect(view.bounds.lower?.id).toBe(2);
  });

  it("adds (interleaf)", async () => {
    await items.push([ids(2.5), [add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2.5), [add]);
    expect(view.bounds.lower?.id).toBe(2.5);
  });

  it("adds (mixed interleaf)", async () => {
    await items.push([ids(1.5, 2.5), [add, add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2, 2.5), [add, add]);
    expect(view.bounds.lower?.id).toBe(2);
  });

  it("removes (no interleaf)", async () => {
    await items.push([ids(1), [del], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [del]);
    expect(view.bounds.lower?.id).toBe(4);
  });

  it("removes (interleaf)", async () => {
    await items.push([ids(3), [del], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [del]);
    expect(view.bounds.lower?.id).toBe(4);
  });

  it("removes (mixed interleaf)", async () => {
    await items.push([ids(2, 3), [del, del], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 4), [del, del]);
    expect(view.bounds.lower?.id).toBe(5);
  });

  it("adds=removes (no interleaf)", async () => {
    await items.push([ids(1, 1.5), [del, add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(), []);
    expect(view.bounds.lower?.id).toBe(3);
  });

  it("adds=removes (interleaf)", async () => {
    await items.push([ids(2, 2.5, 3.5), [del, add, add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3.5), [add]);
    expect(view.bounds.lower?.id).toBe(3);
  });

  it("adds>removes (no interleaf)", async () => {
    await items.push([ids(1, 1.5, 2), [del, add, del], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [del]);
    expect(view.bounds.lower?.id).toBe(4);
  });

  it("adds>removes (interleaf)", async () => {
    await items.push([
      ids(1, 2, 2.5, 3.5, 5.5),
      [del, del, add, add, add],
      idShape,
    ]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 3.5, 5.5), [del, add, add]);
    expect(view.bounds.lower?.id).toBe(3.5);
  });

  it("adds<removes (no interleaf)", async () => {
    await items.push([ids(0.5, 1, 1.5), [add, del, add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2), [add]);
    expect(view.bounds.lower?.id).toBe(2);
  });

  it("adds<removes (interleaf)", async () => {
    await items.push([ids(0.5, 1, 2.5), [add, del, add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2.5), [add]);
    expect(view.bounds.lower?.id).toBe(2.5);
  });

  it("adds<removes (interleaf 2)", async () => {
    await items.push([ids(0.5, 1, 1.5, 2.5), [add, del, add, add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2, 2.5), [add, add]);
    expect(view.bounds.lower?.id).toBe(2);
  });

  it("adds<removes (interleaf 3)", async () => {
    await items.push([ids(0.25, 0.5, 2), [add, add, del], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1), [add]);
    expect(view.bounds.lower?.id).toBe(1);
  });

  it("updates at anchor", async () => {
    await items.push([updIds(3), [upd], idShape]);
    expect(delta).toHaveBeenLastCalledWith(updIds(3), [upd]);
    expect(view.bounds.lower?.id).toBe(3);
  });

  it("removes then updates at anchor", async () => {
    await items.push([[...ids(1.5), ...updIds(3)], [add, upd], idShape]);
    expect(delta).toHaveBeenLastCalledWith(
      [...ids(2), ...updIds(3)],
      [add, upd],
    );
    expect(view.bounds.lower?.id).toBe(2);
  });

  it("adds then updates at anchor", async () => {
    await items.push([ids(2, 3), [del, upd], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [del]);
    expect(view.bounds.lower?.id).toBe(4);
  });

  it("skips within", async () => {
    await items.push([ids(1, 2, 3.5, 5.5), [del, del, add, add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 5.5), [del, add]);
    expect(view.bounds.lower?.id).toBe(4);
  });
});

describe("limits upper bound with", async () => {
  let items: ReturnType<typeof upperBoundFixture>["items"];
  let view: ReturnType<typeof upperBoundFixture>["view"];
  let delta: ReturnType<typeof upperBoundFixture>["delta"];

  beforeEach(() => {
    ({ items, view, delta } = upperBoundFixture());
    expect(view.pull()[0]).toEqual(ids(1, 2, 3, 4));
  });

  function upperBoundFixture() {
    const db = new SQLite(":memory:");
    const items = source(idShape, sqlite(db, "items"))();
    items.create(...ids(1, 2, 3, 4, 5, 6));
    const view = range(items, limit(4, 0));
    const delta = mock<(data: { id: number }[], meta: number[]) => void>();
    view.connect((x) => delta(x[0], x[1]));
    return { items, view, delta };
  }

  it("adds (out of range)", async () => {
    await items.push([ids(4.5), [add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(), []);
    expect(view.bounds.upper?.id).toBe(4);
  });

  it("adds (no interleaf)", async () => {
    await items.push([ids(1.5), [add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 4), [add, del]);
    expect(view.bounds.upper?.id).toBe(3);
  });

  it("adds (interleaf)", async () => {
    await items.push([ids(3.5), [add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3.5, 4), [add, del]);
    expect(view.bounds.upper?.id).toBe(3.5);
  });

  it("adds (mixed interleaf)", async () => {
    await items.push([ids(3.5, 4.5), [add, add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3.5, 4), [add, del]);
    expect(view.bounds.upper?.id).toBe(3.5);
  });

  it("removes (no interleaf)", async () => {
    await items.push([ids(5), [del], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(), []);
    expect(view.bounds.upper?.id).toBe(4);
  });

  it("removes (interleaf)", async () => {
    await items.push([ids(4), [del], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4, 5), [del, add]);
    expect(view.bounds.upper?.id).toBe(5);
  });

  it("removes (mixed interleaf)", async () => {
    await items.push([ids(4, 5), [del, del], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4, 6), [del, add]);
    expect(view.bounds.upper?.id).toBe(6);
  });

  it("adds=removes (no interleaf)", async () => {
    await items.push([ids(1.5, 2), [add, del], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 2), [add, del]);
    expect(view.bounds.upper?.id).toBe(4);
  });

  it("adds=removes (interleaf)", async () => {
    await items.push([ids(4, 4.5), [del, add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4, 4.5), [del, add]);
    expect(view.bounds.upper?.id).toBe(4.5);
  });

  it("adds=removes (mixed interleaf)", async () => {
    await items.push([ids(4, 5.5), [del, add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4, 5), [del, add]);
    expect(view.bounds.upper?.id).toBe(5);
  });

  it("adds>removes (no interleaf)", async () => {
    await items.push([ids(1.5, 2.5, 3), [add, add, del], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 2.5, 3, 4), [
      add,
      add,
      del,
      del,
    ]);
    expect(view.bounds.upper?.id).toBe(2.5);
  });

  it("adds<removes (no interleaf)", async () => {
    await items.push([ids(1.5, 2, 3), [add, del, del], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 2, 3, 5), [
      add,
      del,
      del,
      add,
    ]);
    expect(view.bounds.upper?.id).toBe(5);
  });

  it("updates at anchor", async () => {
    await items.push([updIds(4), [upd], idShape]);
    expect(delta).toHaveBeenLastCalledWith(updIds(4), [upd]);
    expect(view.bounds.upper?.id).toBe(4);
  });

  it("removes then updates at anchor", async () => {
    await items.push([[...ids(3), ...updIds(4)], [del, upd], idShape]);
    expect(delta).toHaveBeenLastCalledWith(
      [...ids(3), ...updIds(4), ...ids(5)],
      [del, upd, add],
    );
    expect(view.bounds.upper?.id).toBe(5);
  });

  it("adds then updates at anchor", async () => {
    await items.push([ids(3.5, 4), [add, upd], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3.5, 4), [add, del]);
    expect(view.bounds.upper?.id).toBe(3.5);
  });

  it("adds extra", async () => {
    await items.push([
      ids(3, 4, 5.5, 7, 8, 9),
      [del, del, add, add, add, add],
      idShape,
    ]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 4, 5, 5.5), [
      del,
      del,
      add,
      add,
    ]);
    expect(view.bounds.upper?.id).toBe(5.5);
  });

  it("skips within", async () => {
    await items.push([ids(1.5, 3.5), [add, add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 4), [add, del]);
    expect(view.bounds.upper?.id).toBe(3);
  });
});

describe("limits both bounds with", async () => {
  let items: ReturnType<typeof bothBoundsFixture>["items"];
  let view: ReturnType<typeof bothBoundsFixture>["view"];
  let delta: ReturnType<typeof bothBoundsFixture>["delta"];

  beforeEach(() => {
    ({ items, view, delta } = bothBoundsFixture());
    expect(view.pull()[0]).toEqual(ids(3, 4));
  });

  function bothBoundsFixture() {
    const db = new SQLite(":memory:");
    const items = source(idShape, sqlite(db, "items"))();
    items.create(...ids(1, 2, 3, 4, 5, 6));
    const view = range(items, limit(2, 2));
    const delta = mock<(data: { id: number }[], meta: number[]) => void>();
    view.connect((x) => delta(x[0], x[1]));
    return { items, view, delta };
  }

  it("multiple adds below - multiple enter, multiple leave", async () => {
    await items.push([ids(1.5, 2.5), [add, add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2, 2.5, 3, 4), [
      add,
      add,
      del,
      del,
    ]);
    expect(view.bounds.lower?.id).toBe(2);
    expect(view.bounds.upper?.id).toBe(2.5);
  });

  it("add below - item enters from below, item leaves from upper", async () => {
    await items.push([ids(1.5), [add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2, 4), [add, del]);
    expect(view.bounds.lower?.id).toBe(2);
    expect(view.bounds.upper?.id).toBe(3);
  });

  it("add just below lower - enters directly, upper pushed out", async () => {
    await items.push([ids(2.5), [add], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2.5, 4), [add, del]);
    expect(view.bounds.lower?.id).toBe(2.5);
    expect(view.bounds.upper?.id).toBe(3);
  });
});
