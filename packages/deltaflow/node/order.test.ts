import { memory, order, reorder, shape, sink, source } from "..";
import { expect, it } from "bun:test";

it("orders items", () => {
  let user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
    order: t.INT,
  }));
  user = reorder(user, "order", "id");

  const users = source(user, memory())();
  users
    .create(
      { id: 0, name: "Bob", order: 3 },
      { id: 1, name: "Alice", order: 1 },
    )
    .flush();

  const view = sink(users);
  expect(users.pull()[2]?.order).toEqual([4, 0]);
  expect(view.pull()[2]?.order).toEqual([4, 0]);

  expect(view.pull()).toEqual(users.pull());
  expect(view.pull()[0]).toEqual([
    { id: 1, name: "Alice", order: 1 },
    { id: 0, name: "Bob", order: 3 },
  ]);

  users.create({ id: -1, name: "Emily", order: 2 });
  expect(view.pull()).toEqual(users.pull());
  expect(view.pull()[0]).toEqual([
    { id: 1, name: "Alice", order: 1 },
    { id: -1, name: "Emily", order: 2 },
    { id: 0, name: "Bob", order: 3 },
  ]);

  users.create({ id: 2, name: "Clara", order: 1 });
  expect(view.pull()).toEqual(users.pull());
  expect(view.pull()[0]).toEqual([
    { id: 1, name: "Alice", order: 1 },
    { id: 2, name: "Clara", order: 1 },
    { id: -1, name: "Emily", order: 2 },
    { id: 0, name: "Bob", order: 3 },
  ]);
});

it("reorders items", () => {
  let user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));

  const users = source(user, memory())();
  users.create({ id: 0, name: "Bob" }, { id: 1, name: "Alice" }).flush();

  const view = sink(order(users, "name"));

  expect(users.pull()[0]).toEqual([
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);

  expect(view.pull()[0]).toEqual([
    { id: 1, name: "Alice" },
    { id: 0, name: "Bob" },
  ]);

  users.create({ id: 2, name: "Brain" }, { id: 3, name: "Alex" });

  expect(users.pull()[0]).toEqual([
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
    { id: 2, name: "Brain" },
    { id: 3, name: "Alex" },
  ]);

  expect(view.pull()[0]).toEqual([
    { id: 3, name: "Alex" },
    { id: 1, name: "Alice" },
    { id: 0, name: "Bob" },
    { id: 2, name: "Brain" },
  ]);

  users.create({ id: 4, name: "Alice" });
  expect(users.pull()[0]).toEqual([
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
    { id: 2, name: "Brain" },
    { id: 3, name: "Alex" },
    { id: 4, name: "Alice" },
  ]);
  expect(view.pull()[0]).toEqual([
    { id: 3, name: "Alex" },
    { id: 1, name: "Alice" },
    { id: 4, name: "Alice" },
    { id: 0, name: "Bob" },
    { id: 2, name: "Brain" },
  ]);

  expect(users.pull()[2]).toBe(user);
  expect(view.pull()[2]?.order).toEqual([2, 0]);
});
