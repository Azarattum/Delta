import { expect, it, mock } from "bun:test";
import {
  filter,
  fork,
  join,
  map,
  memory,
  memoryMergeMetadata,
  sink,
  z2cl,
} from "./nodes";
import { nest, reorder, shape } from "./shape";

it("fails with invalid data", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));
  const userReverse = reorder(user, ["id", "desc"]);

  const users = memory(user, [{ id: 0, name: "Bob" }]);
  users.push([[{ id: 1, name: "Alice" }], [1], userReverse]);
  expect(() => users.flush()).toThrowError("Incompatible shapes");
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
  users.push([[{ id: 2, name: "Alex" }], [1]]);
  users.push([[{ id: 2, name: "Nobody" }], [1]]);
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
    const [data, metadata, shape] = users.pull();
    expect(data).toEqual([
      { id: 0, name: "Bob", children: [] },
      { id: 1, name: "Alice", children: [{ id: 3, name: "Clara" }] },
    ]);
    expect({ ...metadata } as any).toEqual({
      0: 1,
      1: 1,
      children: [[], [1]],
    });
    expect(shape).toBe(parent);
  }

  // Create one more
  users.push([
    [{ id: 1, name: "Alice", children: [{ id: 4, name: "Kate" }] }],
    Object.assign([0], { children: [[1]] }),
  ]);
  {
    const [data, metadata, shape] = users.pull();
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
    expect({ ...metadata } as any).toEqual({
      0: 1,
      1: 1,
      children: [[], [1, 1]],
    });
    expect(shape).toBe(parent);
  }

  // Update
  users.push([
    [{ id: 1, name: "Alice", children: [{ id: 4, name: "Katelyn" }] }],
    Object.assign([0], { children: [[0]] }),
  ]);
  {
    const [data, metadata, shape] = users.pull();
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
    expect({ ...metadata } as any).toEqual({
      0: 1,
      1: 1,
      children: [[], [1, 1]],
    });
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
    const [data, metadata, shape] = users.pull();
    expect(data).toEqual([
      { id: 0, name: "Bob", children: [{ id: 5, name: "Hank" }] },
      { id: 1, name: "Alice", children: [{ id: 4, name: "Katelyn" }] },
    ]);
    expect({ ...metadata } as any).toEqual({
      0: 1,
      1: 1,
      children: [[1], [1]],
    });
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
    const [data, metadata, shape] = users.pull();
    expect(data).toEqual([
      { id: 0, name: "Bob", children: [] },
      { id: 1, name: "Alice", children: [] },
    ]);
    expect({ ...metadata } as any).toEqual({
      0: 1,
      1: 1,
      children: [[], []],
    });
    expect(shape).toBe(parent);
  }
});

it("joins streams", () => {
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

  const joined = sink(join(users, "id", messages, "user", "messages"));

  {
    const [data, metadata, shape] = joined.pull();
    expect(data).toEqual([
      {
        id: 0,
        name: "Bob",
        messages: [
          { id: 0, text: "Hello", user: 0 },
          { id: 1, text: "I'm Bob", user: 0 },
        ],
      },
      {
        id: 1,
        name: "Alice",
        messages: [{ id: 2, text: "And I'm Alice!", user: 1 }],
      },
    ]);
    expect({ ...(metadata as any) }).toEqual({
      0: 1,
      1: 1,
      messages: [[1, 1], [1]],
    });
    expect(shape).toEqual(userWithMessages);
  }

  messages.push([[{ id: 4, text: "Nice to meet you!", user: 1 }], [1]]);
  {
    const [data, metadata, shape] = joined.pull();
    expect(data).toEqual([
      {
        id: 0,
        name: "Bob",
        messages: [
          { id: 0, text: "Hello", user: 0 },
          { id: 1, text: "I'm Bob", user: 0 },
        ],
      },
      {
        id: 1,
        name: "Alice",
        messages: [
          { id: 2, text: "And I'm Alice!", user: 1 },
          { id: 4, text: "Nice to meet you!", user: 1 },
        ],
      },
    ]);
    expect({ ...(metadata as any) }).toEqual({
      0: 1,
      1: 1,
      messages: [
        [1, 1],
        [1, 1],
      ],
    });
    expect(shape).toEqual(userWithMessages);
  }

  users.push([[{ id: 2, name: "Emily" }], [1]]);
  {
    const [data, metadata, shape] = joined.pull();
    expect(data).toEqual([
      {
        id: 0,
        name: "Bob",
        messages: [
          { id: 0, text: "Hello", user: 0 },
          { id: 1, text: "I'm Bob", user: 0 },
        ],
      },
      {
        id: 1,
        name: "Alice",
        messages: [
          { id: 2, text: "And I'm Alice!", user: 1 },
          { id: 4, text: "Nice to meet you!", user: 1 },
        ],
      },
      {
        id: 2,
        name: "Emily",
        messages: [{ id: 3, text: "I'll be here!", user: 2 }],
      },
    ]);
    expect({ ...(metadata as any) }).toEqual({
      0: 1,
      1: 1,
      2: 1,
      messages: [[1, 1], [1, 1], [1]],
    });
    expect(shape).toEqual(userWithMessages);
  }

  messages.push([
    [
      { id: 1, text: "I'm Bob", user: 0 }, // Delete message
      { id: 3, text: "I am here!", user: 2 }, // Edit message
    ],
    [-1, 0],
  ]);
  {
    const [data, metadata, shape] = joined.pull();
    expect(data).toEqual([
      {
        id: 0,
        name: "Bob",
        messages: [{ id: 0, text: "Hello", user: 0 }],
      },
      {
        id: 1,
        name: "Alice",
        messages: [
          { id: 2, text: "And I'm Alice!", user: 1 },
          { id: 4, text: "Nice to meet you!", user: 1 },
        ],
      },
      {
        id: 2,
        name: "Emily",
        messages: [{ id: 3, text: "I am here!", user: 2 }],
      },
    ]);
    expect({ ...(metadata as any) }).toEqual({
      0: 1,
      1: 1,
      2: 1,
      messages: [[1], [1, 1], [1]],
    });
    expect(shape).toEqual(userWithMessages);
  }

  messages.push([
    [
      { id: 4, text: "Nice to meet you!", user: 1 }, // Move Alice's message to Emily
      { id: 4, text: "Nice to meet you!", user: 2 },
    ],
    // Updating relationship keys or primary keys is not allowed! (using remove/add instead)
    [-1, 1],
  ]);
  {
    const [data, metadata, shape] = joined.pull();
    expect(data).toEqual([
      {
        id: 0,
        name: "Bob",
        messages: [{ id: 0, text: "Hello", user: 0 }],
      },
      {
        id: 1,
        name: "Alice",
        messages: [{ id: 2, text: "And I'm Alice!", user: 1 }],
      },
      {
        id: 2,
        name: "Emily",
        messages: [
          { id: 3, text: "I am here!", user: 2 },
          { id: 4, text: "Nice to meet you!", user: 2 },
        ],
      },
    ]);
    expect({ ...(metadata as any) }).toEqual({
      0: 1,
      1: 1,
      2: 1,
      messages: [[1], [1], [1, 1]],
    });
    expect(shape).toEqual(userWithMessages);
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
  const view = sink(changes);

  const spy = mock();
  changes.subscribe(spy);

  {
    const [data, metadata, shape] = view.pull();
    expect(data).toEqual([
      {
        id: 0,
        name: "BOB",
        messages: [{ id: 1, text: "i'm bob" }],
      },
    ]);
    expect({ ...(metadata as any) }).toEqual({
      0: 1,
      messages: [[1]],
    });
    expect(shape).toEqual(userWithMessages);
  }

  users.push([[{ id: 2, name: "Clara" }], [1]]);
  {
    const [data, metadata, shape] = view.pull();
    expect(data).toEqual([
      {
        id: 0,
        name: "BOB",
        messages: [{ id: 1, text: "i'm bob" }],
      },
      { id: 2, name: "CLARA", messages: [{ id: 3, text: "i'll be here!" }] },
    ]);
    expect({ ...(metadata as any) }).toEqual({
      0: 1,
      1: 1,
      messages: [[1], [1]],
    });
    expect(shape).toEqual(userWithMessages);
  }

  messages.push([
    [{ id: 4, text: "Whatever message!", user: 2 }],
    [1],
    message,
  ]);
  {
    const [data, metadata, shape] = view.pull();
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
    expect({ ...(metadata as any) }).toEqual({
      0: 1,
      1: 1,
      messages: [[1], [1, 1]],
    });
    expect(shape).toEqual(userWithMessages);
  }

  expect(spy).toHaveBeenLastCalledWith([
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

  users.push([[{ id: -1, name: "Emily", order: 2 }], [1]]);
  expect(view.pull()).toEqual(users.pull());
  expect(view.pull()[0]).toEqual([
    { id: 1, name: "Alice", order: 1 },
    { id: -1, name: "Emily", order: 2 },
    { id: 0, name: "Bob", order: 3 },
  ]);

  users.push([[{ id: 2, name: "Clara", order: 1 }], [1]]);
  expect(view.pull()).toEqual(users.pull());
  expect(view.pull()[0]).toEqual([
    { id: 1, name: "Alice", order: 1 },
    { id: 2, name: "Clara", order: 1 },
    { id: -1, name: "Emily", order: 2 },
    { id: 0, name: "Bob", order: 3 },
  ]);
});

it("joins changes correctly", () => {
  const parent = shape((t) => ({ id: t(t.INT, t.PRIMARY) }));
  const child = shape((t) => ({ id: t.PRIMARY, ref: t.INT }));
  const both = nest(parent, "item", child);

  const input1 = memory(parent, [{ id: 0 }]);
  const input2 = memory(child, [{ id: 0, ref: 2 }]);
  const joined = join(input1, "id", input2, "ref", "item");

  const spy = mock();
  joined.connect(spy);

  // Noop update
  joined.push([[{ id: 2 }], [0]], undefined);
  expect(spy).not.toHaveBeenCalled();
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([[{ id: 2 }], [0]]);

  // Only left
  joined.push([[{ id: 1 }], [1], parent], undefined);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([[{ id: 1, item: [] }], [1], both]);

  // Only right
  joined.push(undefined, [[{ id: 1, ref: 1 }], [1]]);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([[], [], parent]);

  // Left with source join
  joined.push([[{ id: 2 }], [1], parent], undefined);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 2, item: [{ id: 0, ref: 2 }] }],
    [1],
    both,
  ]);

  // Right with source join
  joined.push(undefined, [[{ id: 1, ref: 0 }], [1], child]);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 0, item: [{ id: 1, ref: 0 }] }],
    [0],
    both,
  ]);

  // Join between deltas
  joined.push([[{ id: 3 }], [1], parent], [[{ id: 1, ref: 3 }], [1], child]);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 3, item: [{ id: 1, ref: 3 }] }],
    [1],
    both,
  ]);

  // Cross-join between deltas and source
  joined.push(
    [[{ id: 2 }], [1], parent],
    [
      [
        { id: 3, ref: 2 },
        { id: 4, ref: 0 },
      ],
      [1, 1],
    ],
  );
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [
      { id: 0, item: [{ id: 4, ref: 0 }] },
      {
        id: 2,
        item: [
          { id: 0, ref: 2 },
          { id: 3, ref: 2 },
        ],
      },
    ],
    [0, 1],
    both,
  ]);

  // Empty left join
  joined.push(
    [[], [], parent],
    [
      [
        { id: 3, ref: 2 },
        { id: 4, ref: 0 },
      ],
      [1, 1],
      child,
    ],
  );
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 0, item: [{ id: 4, ref: 0 }] }],
    [0],
    both,
  ]);

  // Empty right join
  joined.push([[{ id: 2 }], [1], parent], [[], [], child]);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 2, item: [{ id: 0, ref: 2 }] }],
    [1],
    both,
  ]);

  joined.push(undefined, undefined);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([[], []]);
});

it("converts ZSet to CLSet", async () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
    age: t.INT,
  }));

  const users = memory(user, [
    { id: 0, name: "Bob", age: 17 },
    { id: 1, name: "Alice", age: 22 },
  ]);

  const peer = 42;
  const metadata = memoryMergeMetadata(users, peer, [
    [0, [1, 1, 1, peer, 1, peer]],
  ]);

  // TODO: consider forking before pushing to users,
  //  to avoid z2cl node when receiving changes in a full pipeline
  //  this would mean we would want some kind of `input` node

  // Fork changes to copy them to 2 streams
  const [users1, users2] = fork(users);
  const changes = z2cl(users1, metadata);
  const view = sink(users2);

  // Materialize view
  view.pull();

  const spy = mock();
  changes.connect(spy);
  expect(spy).not.toHaveBeenCalled();

  users.push([[{ id: 2, name: "Eve", age: 20 }], [1]]);
  expect(spy).not.toHaveBeenCalled();
  changes.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 2, name: "Eve", age: 20 }],
    [[2, 1, 1, 42, 1, 42]],
    user,
  ]);

  expect(view.pull()[0]).toEqual([
    { id: 0, name: "Bob", age: 17 },
    { id: 1, name: "Alice", age: 22 },
    { id: 2, name: "Eve", age: 20 },
  ]);
});
