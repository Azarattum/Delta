import { filter, memory, join, map, sink, nest, reorder, shape } from "..";
import { expect, it, mock, spyOn } from "bun:test";

it("fails with invalid data", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));
  const userReverse = reorder(user, ["id", "desc"]);

  const users = memory(user, [{ id: 0, name: "Bob" }]);
  users.push([[{ id: 1, name: "Alice" }], [1], userReverse]);

  const consoleErrorMock = spyOn(console, "error").mockImplementation(() => {});
  users.flush();
  expect(consoleErrorMock).toHaveBeenCalledTimes(1);
  consoleErrorMock.mockRestore();

  expect(() => nest(nest(user, "child", user), "child", userReverse)).toThrow();
});

it("performs basic CRUD", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));

  const users = memory(user, [
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);
  users.pull = mock(users.pull);
  const predicate = mock((x) => x.name.startsWith("A"));
  const view = sink(filter(users, predicate));

  // Read
  expect(predicate).not.toHaveBeenCalled();
  expect(view.pull()).toEqual([[{ id: 1, name: "Alice" }], [1], user]);
  expect(predicate).toHaveBeenCalled();

  // Create
  users.push([[{ id: 2, name: "Nobody" }], [1], user]);
  users.push([[{ id: 2, name: "Alex" }], [1], user]);
  expect(view.pull()).toEqual([
    [
      { id: 1, name: "Alice" },
      { id: 2, name: "Alex" },
    ],
    [1, 1],
    user,
  ]);

  // Delete
  users.push([[{ id: 1, name: "Alice" }], [-1]]);
  expect(view.pull()).toEqual([[{ id: 2, name: "Alex" }], [1], user]);

  // Update
  users.push([[{ id: 2, name: "Alexandra" }], [0]]);
  expect(view.pull()).toEqual([[{ id: 2, name: "Alexandra" }], [1], user]);

  expect(users.pull).toHaveBeenCalledTimes(1);
  expect(users.pull()).toEqual([
    [
      { id: 0, name: "Bob" },
      { id: 2, name: "Alexandra" },
    ],
    [1, 1],
    user,
  ]);
});

it("updates children", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));
  const parent = nest(user, "children", user);
  type User = (typeof parent)["~type"];

  const users = memory<User>(parent, [
    { id: 0, name: "Bob", children: [] },
    { id: 1, name: "Alice", children: [] },
  ]);

  // Create
  users.push([
    [{ id: 1, name: "Alice", children: [{ id: 3, name: "Clara" }] }],
    Object.assign([0], { children: [[1]] }),
  ]);
  {
    const [data, meta, shape] = users.pull();
    expect(data).toEqual([
      { id: 0, name: "Bob", children: [] },
      { id: 1, name: "Alice", children: [{ id: 3, name: "Clara" }] },
    ]);
    expect(meta).toEqual([1, 1] as any);
    expect(shape).toBe(parent);
  }

  // Create one more
  users.push([
    [{ id: 1, name: "Alice", children: [{ id: 4, name: "Kate" }] }],
    Object.assign([0], { children: [[1]] }),
  ]);
  {
    const [data, meta, shape] = users.pull();
    expect(data).toEqual([
      { id: 0, name: "Bob", children: [] },
      {
        id: 1,
        name: "Alice",
        children: [
          { id: 3, name: "Clara" },
          { id: 4, name: "Kate" },
        ],
      },
    ]);
    expect(meta).toEqual([1, 1] as any);
    expect(shape).toBe(parent);
  }

  // Update
  users.push([
    [{ id: 1, name: "Alice", children: [{ id: 4, name: "Katelyn" }] }],
    Object.assign([0], { children: [[0]] }),
  ]);
  {
    const [data, meta, shape] = users.pull();
    expect(data).toEqual([
      { id: 0, name: "Bob", children: [] },
      {
        id: 1,
        name: "Alice",
        children: [
          { id: 3, name: "Clara" },
          { id: 4, name: "Katelyn" },
        ],
      },
    ]);
    expect(meta).toEqual([1, 1] as any);
    expect(shape).toBe(parent);
  }

  // Delete & Create
  users.push([
    [
      { id: 0, name: "Bob", children: [{ id: 5, name: "Hank" }] },
      { id: 1, name: "Alice", children: [{ id: 3, name: "Clara" }] },
    ],
    Object.assign([0, 0], { children: [[1], [-1]] }),
  ]);
  {
    const [data, meta, shape] = users.pull();
    expect(data).toEqual([
      { id: 0, name: "Bob", children: [{ id: 5, name: "Hank" }] },
      { id: 1, name: "Alice", children: [{ id: 4, name: "Katelyn" }] },
    ]);
    expect(meta).toEqual([1, 1] as any);
    expect(shape).toBe(parent);
  }

  // Delete All
  users.push([
    [
      { id: 0, name: "Bob", children: [{ id: 5, name: "Hank" }] },
      { id: 1, name: "Alice", children: [{ id: 4, name: "Katelyn" }] },
    ],
    Object.assign([0, 0], { children: [[-1], [-1]] }),
  ]);
  {
    const [data, meta, shape] = users.pull();
    expect(data).toEqual([
      { id: 0, name: "Bob", children: [] },
      { id: 1, name: "Alice", children: [] },
    ]);
    expect(meta).toEqual([1, 1] as any);
    expect(shape).toBe(parent);
  }
});

it("processes full pipeline", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    user: t.INT,
  }));
  const userWithMessages = nest(user, "messages", message);

  const users = memory(user, [
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);
  const messages = memory(message, [
    { id: 0, text: "Hello", user: 0 },
    { id: 1, text: "I'm Bob", user: 0 },
    { id: 2, text: "And I'm Alice!", user: 1 },
    { id: 3, text: "I'll be here!", user: 2 },
  ]);

  const changes = map(
    join(
      map(
        filter(users, (x) => !x.name.startsWith("A")),
        (x) => ((x.name = x.name.toUpperCase()), x),
      ),
      "id",
      map(
        filter(messages, (x) => x.text.length > 5),
        (x) => ((x.text = x.text.toLowerCase()), x),
      ),
      "user",
      "messages",
    ),
    (x) => (
      x.messages.map((y) => delete (y as any).user),
      x as Omit<typeof x, "messages"> & {
        messages: Omit<(typeof x)["messages"][number], "user">[];
      }
    ),
  );

  let lastDelta: any = undefined;
  changes.connect((x) => (lastDelta = structuredClone(x)));
  const view = sink(changes);

  {
    const [data, meta, shape] = view.pull();
    expect(data).toEqual([
      {
        id: 0,
        name: "BOB",
        messages: [{ id: 1, text: "i'm bob" }],
      },
    ]);
    expect({ ...(meta as any) }).toEqual({
      0: 1,
      messages: [[1]],
    });
    expect(shape).toEqual(userWithMessages as any);
  }

  users.push([[{ id: 2, name: "Clara" }], [1]]);
  {
    const [data, meta, shape] = view.pull();
    expect(data).toEqual([
      {
        id: 0,
        name: "BOB",
        messages: [{ id: 1, text: "i'm bob" }],
      },
      { id: 2, name: "CLARA", messages: [{ id: 3, text: "i'll be here!" }] },
    ]);
    expect({ ...(meta as any) }).toEqual({
      0: 1,
      1: 1,
      messages: [[1], [1]],
    });
    expect(shape).toEqual(userWithMessages as any);
  }

  messages.push([
    [{ id: 4, text: "Whatever message!", user: 2 }],
    [1],
    message,
  ]);
  {
    const [data, meta, shape] = view.pull();
    expect(data).toEqual([
      {
        id: 0,
        name: "BOB",
        messages: [{ id: 1, text: "i'm bob" }],
      },
      {
        id: 2,
        name: "CLARA",
        messages: [
          { id: 3, text: "i'll be here!" },
          { id: 4, text: "whatever message!" },
        ],
      },
    ]);
    expect({ ...(meta as any) }).toEqual({
      0: 1,
      1: 1,
      messages: [[1], [1, 1]],
    });
    expect(shape).toEqual(userWithMessages as any);
  }

  expect(lastDelta).toEqual([
    [
      {
        id: 2,
        name: "CLARA",
        messages: [{ id: 4, text: "whatever message!" }],
      },
    ],
    [0],
    userWithMessages,
  ]);
});
