import { shape, range, sink, limit, sqlite } from "..";
import { it, expect, describe, beforeEach, vi } from "bun:test";
import SQLite from "bun:sqlite";

const idShape = shape((t) => ({ id: t(t.DOUBLE, t.PRIMARY) }));
const ids = (...x: number[]) => x.map((id) => ({ id }));

it("limits simple queries", async () => {
  const user = shape((t) => ({ id: t(t.INT, t.PRIMARY), name: t.STRING }));

  const db = new SQLite(":memory:");
  const users = sqlite(db, "users", user, [
    { id: 0, name: "Aron" },
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
    { id: 30, name: "Clara" },
    { id: 40, name: "Dave" },
  ]);

  const view = sink(range(users, limit(3, 1)));

  expect(view.pull()[0]).toEqual([
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
    { id: 30, name: "Clara" },
  ]);

  users.push([[{ id: 50, name: "Eve" }], [1], user]);
  await users.flush();

  expect(view.pull()[0]).toEqual([
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
    { id: 30, name: "Clara" },
  ]);

  users.push([
    [
      { id: 5, name: "Aron" },
      { id: 25, name: "Agatha" },
      { id: 35, name: "Dave" },
    ],
    [1, 1, 1],
    user,
  ]);
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
  const users = sqlite(db, "users", user, [
    { id: 0, name: "Aron" },
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
    { id: 30, name: "Clara" },
    { id: 40, name: "Dave" },
  ]);

  const view = sink(range(users, limit(3, 1)));
  // TODO: this `.pull` should not be necessary
  view.pull();

  users.push([
    [
      { id: 25, name: "Agatha" },
      { id: 27, name: "Gina" },
      { id: 28, name: "Hannah" },
    ],
    [1, 1, 1],
    user,
  ]);
  await users.flush();

  expect(view.pull()[0]).toEqual([
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
    { id: 25, name: "Agatha" },
  ]);

  users.push([[{ id: 28, name: "Hannah" }], [-1], user]);
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
  const users = sqlite(db, "users", user, [
    { id: 0, name: "Aron" },
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
    { id: 30, name: "Clara" },
    { id: 40, name: "Dave" },
    { id: 50, name: "Eve" },
  ]);

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
  const users = sqlite(db, "users", user, [
    { id: 0, name: "Aron" },
    { id: 10, name: "Alice" },
    { id: 20, name: "Bob" },
    { id: 30, name: "Clara" },
    { id: 40, name: "Dave" },
    { id: 50, name: "Eve" },
  ]);

  const window = limit(3, 1);
  const view = sink(range(users, window));

  window.push([3, 2]);
  users.push([[{ id: 35, name: "Eve" }], [1], user]);

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
    const users = sqlite(db, "users", user, [
      { id: 0, name: "Aron" },
      { id: 10, name: "Alice" },
      { id: 20, name: "Bob" },
      { id: 30, name: "Clara" },
      { id: 40, name: "Dave" },
      { id: 50, name: "Eve" },
    ]);

    const view = sink(range(users, limit(i, 1)));
    expect(view.pull()[0]).toEqual(
      [
        { id: 10, name: "Alice" },
        { id: 20, name: "Bob" },
        { id: 30, name: "Clara" },
      ].slice(0, i),
    );

    users.push(structuredClone([data, meta, user]));
    await users.flush();
    expect(view.pull()[0]).toEqual(expected.slice(0, i));
  });
});

describe("limits lower bound with", async () => {
  let items: ReturnType<typeof sqlite<{ id: number }>>;
  let view: ReturnType<typeof range<typeof items, { id: number }>>;
  let delta: ReturnType<
    typeof vi.fn<(data: { id: number }[], meta: number[]) => void>
  >;

  beforeEach(() => {
    const db = new SQLite(":memory:");
    items = sqlite(db, "items", idShape, ids(1, 2, 3, 4, 5, 6));
    view = range(items, limit(10, 2));
    expect(view.pull()[0]).toEqual(ids(3, 4, 5, 6));

    delta = vi.fn();
    view.connect((x) => delta(x[0], x[1]));
  });

  it("adds (no interleaf)", async () => {
    await items.push([ids(1.5), [1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2), [1]);
    expect(view.bounds.lower?.id).toBe(2);
  });

  it("adds (interleaf)", async () => {
    await items.push([ids(2.5), [1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2.5), [1]);
    expect(view.bounds.lower?.id).toBe(2.5);
  });

  it("adds (mixed interleaf)", async () => {
    await items.push([ids(1.5, 2.5), [1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2, 2.5), [1, 1]);
    expect(view.bounds.lower?.id).toBe(2);
  });

  it("removes (no interleaf)", async () => {
    await items.push([ids(1), [-1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [-1]);
    expect(view.bounds.lower?.id).toBe(4);
  });

  it("removes (interleaf)", async () => {
    await items.push([ids(3), [-1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [-1]);
    expect(view.bounds.lower?.id).toBe(4);
  });

  it("removes (mixed interleaf)", async () => {
    await items.push([ids(2, 3), [-1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 4), [-1, -1]);
    expect(view.bounds.lower?.id).toBe(5);
  });

  it("adds=removes (no interleaf)", async () => {
    await items.push([ids(1, 1.5), [-1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(), []);
    expect(view.bounds.lower?.id).toBe(3);
  });

  it("adds=removes (interleaf)", async () => {
    await items.push([ids(2, 2.5, 3.5), [-1, 1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3.5), [1]);
    expect(view.bounds.lower?.id).toBe(3);
  });

  it("adds>removes (no interleaf)", async () => {
    await items.push([ids(1, 1.5, 2), [-1, 1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [-1]);
    expect(view.bounds.lower?.id).toBe(4);
  });

  it("adds>removes (interleaf)", async () => {
    await items.push([ids(1, 2, 2.5, 3.5, 5.5), [-1, -1, 1, 1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 3.5, 5.5), [-1, 1, 1]);
    expect(view.bounds.lower?.id).toBe(3.5);
  });

  it("adds<removes (no interleaf)", async () => {
    await items.push([ids(0.5, 1, 1.5), [1, -1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2), [1]);
    expect(view.bounds.lower?.id).toBe(2);
  });

  it("adds<removes (interleaf)", async () => {
    await items.push([ids(0.5, 1, 2.5), [1, -1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2.5), [1]);
    expect(view.bounds.lower?.id).toBe(2.5);
  });

  it("adds<removes (interleaf 2)", async () => {
    await items.push([ids(0.5, 1, 1.5, 2.5), [1, -1, 1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2, 2.5), [1, 1]);
    expect(view.bounds.lower?.id).toBe(2);
  });

  it("adds<removes (interleaf 3)", async () => {
    await items.push([ids(0.25, 0.5, 2), [1, 1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1), [1]);
    expect(view.bounds.lower?.id).toBe(1);
  });

  it("updates at anchor", async () => {
    await items.push([ids(3), [0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [0]);
    expect(view.bounds.lower?.id).toBe(3);
  });

  it("removes then updates at anchor", async () => {
    await items.push([ids(1.5, 3), [1, 0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2, 3), [1, 0]);
    expect(view.bounds.lower?.id).toBe(2);
  });

  it("adds then updates at anchor", async () => {
    await items.push([ids(2, 3), [-1, 0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3), [-1]);
    expect(view.bounds.lower?.id).toBe(4);
  });

  it("skips within", async () => {
    await items.push([ids(1, 2, 3.5, 5.5), [-1, -1, 1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 5.5), [-1, 1]);
    expect(view.bounds.lower?.id).toBe(4);
  });
});

describe("limits upper bound with", async () => {
  let items: ReturnType<typeof sqlite<{ id: number }>>;
  let view: ReturnType<typeof range<typeof items, { id: number }>>;
  let delta: ReturnType<
    typeof vi.fn<(data: { id: number }[], meta: number[]) => void>
  >;

  beforeEach(() => {
    const db = new SQLite(":memory:");
    items = sqlite(db, "items", idShape, ids(1, 2, 3, 4, 5, 6));
    view = range(items, limit(4, 0));
    expect(view.pull()[0]).toEqual(ids(1, 2, 3, 4));

    delta = vi.fn();
    view.connect((x) => delta(x[0], x[1]));
  });

  it("adds (out of range)", async () => {
    await items.push([ids(4.5), [1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(), []);
    expect(view.bounds.upper?.id).toBe(4);
  });

  it("adds (no interleaf)", async () => {
    await items.push([ids(1.5), [1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 4), [1, -1]);
    expect(view.bounds.upper?.id).toBe(3);
  });

  it("adds (interleaf)", async () => {
    await items.push([ids(3.5), [1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3.5, 4), [1, -1]);
    expect(view.bounds.upper?.id).toBe(3.5);
  });

  it("adds (mixed interleaf)", async () => {
    await items.push([ids(3.5, 4.5), [1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3.5, 4), [1, -1]);
    expect(view.bounds.upper?.id).toBe(3.5);
  });

  it("removes (no interleaf)", async () => {
    await items.push([ids(5), [-1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(), []);
    expect(view.bounds.upper?.id).toBe(4);
  });

  it("removes (interleaf)", async () => {
    await items.push([ids(4), [-1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4, 5), [-1, 1]);
    expect(view.bounds.upper?.id).toBe(5);
  });

  it("removes (mixed interleaf)", async () => {
    await items.push([ids(4, 5), [-1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4, 6), [-1, 1]);
    expect(view.bounds.upper?.id).toBe(6);
  });

  it("adds=removes (no interleaf)", async () => {
    await items.push([ids(1.5, 2), [1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 2), [1, -1]);
    expect(view.bounds.upper?.id).toBe(4);
  });

  it("adds=removes (interleaf)", async () => {
    await items.push([ids(4, 4.5), [-1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4, 4.5), [-1, 1]);
    expect(view.bounds.upper?.id).toBe(4.5);
  });

  it("adds=removes (mixed interleaf)", async () => {
    await items.push([ids(4, 5.5), [-1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4, 5), [-1, 1]);
    expect(view.bounds.upper?.id).toBe(5);
  });

  it("adds>removes (no interleaf)", async () => {
    await items.push([ids(1.5, 2.5, 3), [1, 1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 2.5, 3, 4), [1, 1, -1, -1]);
    expect(view.bounds.upper?.id).toBe(2.5);
  });

  it("adds<removes (no interleaf)", async () => {
    await items.push([ids(1.5, 2, 3), [1, -1, -1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 2, 3, 5), [1, -1, -1, 1]);
    expect(view.bounds.upper?.id).toBe(5);
  });

  it("updates at anchor", async () => {
    await items.push([ids(4), [0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(4), [0]);
    expect(view.bounds.upper?.id).toBe(4);
  });

  it("removes then updates at anchor", async () => {
    await items.push([ids(3, 4), [-1, 0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 4, 5), [-1, 0, 1]);
    expect(view.bounds.upper?.id).toBe(5);
  });

  it("adds then updates at anchor", async () => {
    await items.push([ids(3.5, 4), [1, 0], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3.5, 4), [1, -1]);
    expect(view.bounds.upper?.id).toBe(3.5);
  });

  it("adds extra", async () => {
    await items.push([ids(3, 4, 5.5, 7, 8, 9), [-1, -1, 1, 1, 1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(3, 4, 5, 5.5), [-1, -1, 1, 1]);
    expect(view.bounds.upper?.id).toBe(5.5);
  });

  it("skips within", async () => {
    await items.push([ids(1.5, 3.5), [1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(1.5, 4), [1, -1]);
    expect(view.bounds.upper?.id).toBe(3);
  });
});

describe("limits both bounds with", async () => {
  let items: ReturnType<typeof sqlite<{ id: number }>>;
  let view: ReturnType<typeof range<typeof items, { id: number }>>;
  let delta: ReturnType<
    typeof vi.fn<(data: { id: number }[], meta: number[]) => void>
  >;

  beforeEach(() => {
    const db = new SQLite(":memory:");
    items = sqlite(db, "items", idShape, ids(1, 2, 3, 4, 5, 6));
    view = range(items, limit(2, 2));
    expect(view.pull()[0]).toEqual(ids(3, 4));

    delta = vi.fn();
    view.connect((x) => delta(x[0], x[1]));
  });

  it("multiple adds below - multiple enter, multiple leave", async () => {
    await items.push([ids(1.5, 2.5), [1, 1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2, 2.5, 3, 4), [1, 1, -1, -1]);
    expect(view.bounds.lower?.id).toBe(2);
    expect(view.bounds.upper?.id).toBe(2.5);
  });

  it("add below - item enters from below, item leaves from upper", async () => {
    await items.push([ids(1.5), [1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2, 4), [1, -1]);
    expect(view.bounds.lower?.id).toBe(2);
    expect(view.bounds.upper?.id).toBe(3);
  });

  it("add just below lower - enters directly, upper pushed out", async () => {
    await items.push([ids(2.5), [1], idShape]);
    expect(delta).toHaveBeenLastCalledWith(ids(2.5, 4), [1, -1]);
    expect(view.bounds.lower?.id).toBe(2.5);
    expect(view.bounds.upper?.id).toBe(3);
  });
});
