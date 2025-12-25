import { shape, range, sink, limit, sqlite } from "..";
import { it, expect, describe } from "bun:test";
import SQLite from "bun:sqlite";

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

  users.push([[{ id: 40, name: "Eve" }], [1], user]);
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

  // TODO: this will work when we update bounds
  // users.push([[{ id: 28, name: "Hannah" }], [-1], user]);
  // await users.flush();

  // expect(view.pull()[0]).toEqual([
  //   { id: 10, name: "Alice" },
  //   { id: 20, name: "Bob" },
  //   { id: 25, name: "Agatha" },
  // ]);
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

  // TODO: this will work when we update bounds
  // window.push([3, 3]);

  // expect(view.pull()[0]).toEqual([
  //   { id: 30, name: "Clara" },
  //   { id: 40, name: "Dave" },
  //   { id: 50, name: "Eve" },
  // ]);

  // window.push([3, 4]);

  // expect(view.pull()[0]).toEqual([
  //   { id: 40, name: "Dave" },
  //   { id: 50, name: "Eve" },
  // ]);

  // window.push([3, 5]);

  // expect(view.pull()[0]).toEqual([{ id: 50, name: "Eve" }]);

  // window.push([3, 6]);

  // expect(view.pull()[0]).toEqual([]);
});
