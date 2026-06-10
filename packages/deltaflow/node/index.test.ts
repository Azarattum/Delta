import { filter, memory, source, shape, join, sink, nest, map } from "..";
import { create, update } from "../datastructure/zset";
import { expect, it, mock } from "bun:test";

it("performs basic CRUD", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));

  const users = source(user, memory())();
  users.create({ id: 0, name: "Bob" }, { id: 1, name: "Alice" }).flush();
  users.pull = mock(users.pull);
  const predicate = mock((x) => x.name.startsWith("A"));
  const view = sink(filter(users, predicate));

  // Read
  expect(predicate).not.toHaveBeenCalled();
  expect(view.pull()).toEqual([
    [{ id: 1, name: "Alice" }],
    [create(user)],
    user,
  ]);
  expect(predicate).toHaveBeenCalled();

  // Create
  users.create({ id: 2, name: "Nobody" });
  users.create({ id: 2, name: "Alex" });
  expect(view.pull()).toEqual([
    [
      { id: 1, name: "Alice" },
      { id: 2, name: "Alex" },
    ],
    [create(user), create(user)],
    user,
  ]);

  // Delete
  users.delete({ id: 1 });
  expect(view.pull()).toEqual([
    [{ id: 2, name: "Alex" }],
    [create(user)],
    user,
  ]);

  // Update
  users.update({ id: 2, name: "Alexandra" });
  expect(view.pull()).toEqual([
    [{ id: 2, name: "Alexandra" }],
    [create(user)],
    user,
  ]);

  expect(users.pull).toHaveBeenCalledTimes(1);
  expect(users.pull()).toEqual([
    [
      { id: 0, name: "Bob" },
      { id: 2, name: "Alexandra" },
    ],
    [create(user), create(user)],
    user,
  ]);
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

  const users = source(user, memory())();
  users.create({ id: 0, name: "Bob" }, { id: 1, name: "Alice" }).flush();
  const messages = source(message, memory())();
  messages
    .create(
      { id: 0, text: "Hello", user: 0 },
      { id: 1, text: "I'm Bob", user: 0 },
      { id: 2, text: "And I'm Alice!", user: 1 },
      { id: 3, text: "I'll be here!", user: 2 },
    )
    .flush();

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
      0: create(userWithMessages),
      messages: [[create(message)]],
    });
    expect(shape).toEqual(userWithMessages as any);
  }

  users.push([[{ id: 2, name: "Clara" }], [create(user)], user]);
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
      0: create(userWithMessages),
      1: create(userWithMessages),
      messages: [[create(message)], [create(message)]],
    });
    expect(shape).toEqual(userWithMessages as any);
  }

  messages.push([
    [{ id: 4, text: "Whatever message!", user: 2 }],
    [create(message)],
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
      0: create(userWithMessages),
      1: create(userWithMessages),
      messages: [[create(message)], [create(message), create(message)]],
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
    [update(userWithMessages, "messages")],
    userWithMessages,
  ]);
});
