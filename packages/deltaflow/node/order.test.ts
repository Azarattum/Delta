import { memory, order, reorder, shape, sink } from "..";
import { create } from "../datastructure/zset";
import { expect, it } from "bun:test";

it("orders items", () => {
  let user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
    order: t.INT,
  }));
  user = reorder(user, "order", "id");

  const users = memory(user, [
    { id: 0, name: "Bob", order: 3 },
    { id: 1, name: "Alice", order: 1 },
  ]);

  const view = sink(users);
  expect(users.pull()[2]?.order).toEqual([4, 0]);
  expect(view.pull()[2]?.order).toEqual([4, 0]);

  expect(view.pull()).toEqual(users.pull());
  expect(view.pull()[0]).toEqual([
    { id: 1, name: "Alice", order: 1 },
    { id: 0, name: "Bob", order: 3 },
  ]);

  users.push([[{ id: -1, name: "Emily", order: 2 }], [create(user)], user]);
  expect(view.pull()).toEqual(users.pull());
  expect(view.pull()[0]).toEqual([
    { id: 1, name: "Alice", order: 1 },
    { id: -1, name: "Emily", order: 2 },
    { id: 0, name: "Bob", order: 3 },
  ]);

  users.push([[{ id: 2, name: "Clara", order: 1 }], [create(user)], user]);
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

  const users = memory(user, [
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);

  const view = sink(order(users, "name"));

  expect(users.pull()[0]).toEqual([
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);

  expect(view.pull()[0]).toEqual([
    { id: 1, name: "Alice" },
    { id: 0, name: "Bob" },
  ]);

  users.push([
    [
      { id: 2, name: "Brain" },
      { id: 3, name: "Alex" },
    ],
    [create(user), create(user)],
    user,
  ]);

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

  users.push([[{ id: 4, name: "Alice" }], [create(user)], user]);
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
