import { expect, it, mock } from "bun:test";
import { filter, join, map, memory, sink } from "./nodes";

it("fails with invalid data", () => {
  expect(() => memory([])).toThrowError("at least one item");
  const users = memory([{ id: 0, name: "Bob" }], ["id", "asc"]);
  users.push([[{ id: 1, name: "Alice" }], [1], [1]]);
  expect(() => users.flush()).toThrowError("Mismatched order");
});

it("performs basic CRUD", () => {
  const users = memory(
    [
      { id: 0, name: "Bob" },
      { id: 1, name: "Alice" },
    ],
    ["id", "asc"],
  );
  users.pull = mock(users.pull);
  const predicate = mock((x) => x.name.startsWith("A"));
  const view = sink(filter(users, predicate));

  // Read
  expect(predicate).not.toHaveBeenCalled();
  expect(view.pull()).toEqual([[{ id: 1, name: "Alice" }], [1], [0]]);
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
    [0],
  ]);

  // Delete
  users.push([[{ id: 1, name: "Alice" }], [-1]]);
  expect(view.pull()).toEqual([[{ id: 2, name: "Alex" }], [1], [0]]);

  // Update
  users.push([[{ id: 2, name: "Alexandra" }], [0]]);
  expect(view.pull()).toEqual([[{ id: 2, name: "Alexandra" }], [1], [0]]);

  expect(users.pull).toHaveBeenCalledTimes(1);
  expect(users.pull()).toEqual([
    [
      { id: 0, name: "Bob" },
      { id: 2, name: "Alexandra" },
    ],
    [1, 1],
    [0],
  ]);
});

it("updates children", () => {
  type User = { id: number; name: string; children?: User[] };

  const users = memory<User>(
    [
      { id: 0, name: "Bob" },
      { id: 1, name: "Alice" },
    ],
    ["id", "asc"],
  );

  // Create
  users.push([
    [{ id: 1, name: "Alice", children: [{ id: 3, name: "Clara" }] }],
    Object.assign([0], { children: [[1]] }), // Initializes children meta
    Object.assign([0], { children: [0] }), // Initializes children order
  ]);
  {
    const [data, metadata, order] = users.pull();
    expect(data).toEqual([
      { id: 0, name: "Bob" },
      { id: 1, name: "Alice", children: [{ id: 3, name: "Clara" }] },
    ]);
    expect({ ...metadata } as any).toEqual({
      0: 1,
      1: 1,
      children: [undefined, [1]],
    });
    expect({ ...(order as any) }).toEqual({ 0: 0, children: [0] });
  }

  // Create one more
  users.push([
    [{ id: 1, name: "Alice", children: [{ id: 4, name: "Kate" }] }],
    Object.assign([0], { children: [[1]] }),
    // Order is not required
  ]);
  {
    const [data, metadata, order] = users.pull();
    expect(data).toEqual([
      { id: 0, name: "Bob" },
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
      children: [undefined, [1, 1]],
    });
    expect({ ...(order as any) }).toEqual({ 0: 0, children: [0] });
  }

  // Update
  users.push([
    [{ id: 1, name: "Alice", children: [{ id: 4, name: "Katelyn" }] }],
    Object.assign([0], { children: [[0]] }),
  ]);
  {
    const [data, metadata, order] = users.pull();
    expect(data).toEqual([
      { id: 0, name: "Bob" },
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
      children: [undefined, [1, 1]],
    });
    expect({ ...(order as any) }).toEqual({ 0: 0, children: [0] });
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
    const [data, metadata, order] = users.pull();
    expect(data).toEqual([
      { id: 0, name: "Bob", children: [{ id: 5, name: "Hank" }] },
      { id: 1, name: "Alice", children: [{ id: 4, name: "Katelyn" }] },
    ]);
    expect({ ...metadata } as any).toEqual({
      0: 1,
      1: 1,
      children: [[1], [1]],
    });
    expect({ ...(order as any) }).toEqual({ 0: 0, children: [0] });
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
    const [data, metadata, order] = users.pull();
    expect(data).toEqual([
      { id: 0, name: "Bob", children: [] },
      { id: 1, name: "Alice", children: [] },
    ]);
    expect({ ...metadata } as any).toEqual({
      0: 1,
      1: 1,
      children: [[], []],
    });
    expect({ ...(order as any) }).toEqual({ 0: 0, children: [0] });
  }
});

it("joins streams", () => {
  const users = memory(
    [
      { id: 0, name: "Bob" },
      { id: 1, name: "Alice" },
    ],
    ["id", "asc"],
  );
  const messages = memory(
    [
      { id: 0, text: "Hello", user: 0 },
      { id: 1, text: "I'm Bob", user: 0 },
      { id: 2, text: "And I'm Alice!", user: 1 },
      { id: 3, text: "I'll be here!", user: 2 },
    ],
    ["id", "asc"],
  );

  const joined = sink(join(users, "id", messages, "user", "messages"));

  {
    const [data, metadata, order] = joined.pull();
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
    expect({ ...(order as any) }).toEqual({ 0: 0, messages: [0] });
  }

  messages.push([[{ id: 4, text: "Nice to meet you!", user: 1 }], [1]]);
  {
    const [data, metadata, order] = joined.pull();
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
    expect({ ...(order as any) }).toEqual({ 0: 0, messages: [0] });
  }

  users.push([[{ id: 2, name: "Emily" }], [1]]);
  {
    const [data, metadata, order] = joined.pull();
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
    expect({ ...(order as any) }).toEqual({ 0: 0, messages: [0] });
  }

  messages.push([
    [
      { id: 1, text: "I'm Bob", user: 0 }, // Delete message
      { id: 3, text: "I am here!", user: 2 }, // Edit message
    ],
    [-1, 0],
  ]);
  {
    const [data, metadata, order] = joined.pull();
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
    expect({ ...(order as any) }).toEqual({ 0: 0, messages: [0] });
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
    const [data, metadata, order] = joined.pull();
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
    expect({ ...(order as any) }).toEqual({ 0: 0, messages: [0] });
  }
});

it("processes full pipeline", () => {
  const users = memory(
    [
      { id: 0, name: "Bob" },
      { id: 1, name: "Alice" },
    ],
    ["id", "asc"],
  );
  const messages = memory(
    [
      { id: 0, text: "Hello", user: 0 },
      { id: 1, text: "I'm Bob", user: 0 },
      { id: 2, text: "And I'm Alice!", user: 1 },
      { id: 3, text: "I'll be here!", user: 2 },
    ],
    ["id", "asc"],
  );

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

  const flowing = mock();
  changes.subscribe(flowing);

  {
    const [data, metadata, order] = view.pull();
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
    expect({ ...(order as any) }).toEqual({ 0: 0, messages: [0] });
  }

  users.push([[{ id: 2, name: "Clara" }], [1]]);
  {
    const [data, metadata, order] = view.pull();
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
    expect({ ...(order as any) }).toEqual({ 0: 0, messages: [0] });
  }

  messages.push([[{ id: 4, text: "Whatever message!", user: 2 }], [1]]);
  {
    const [data, metadata, order] = view.pull();
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
    expect({ ...(order as any) }).toEqual({ 0: 0, messages: [0] });
  }

  expect(flowing).toHaveBeenLastCalledWith([
    [
      {
        id: 2,
        name: "CLARA",
        messages: [{ id: 4, text: "whatever message!" }],
      },
    ],
    [0],
    [0],
  ]);
});

it("orders items", () => {
  const users = memory(
    [
      { id: 0, name: "Bob", order: 3 },
      { id: 1, name: "Alice", order: 1 },
    ],
    ["order", "asc"],
    ["id", "asc"],
  );

  const view = sink(users);
  expect(users.pull()[2]).toEqual([4, 0]);
  expect(view.pull()[2]).toEqual([4, 0]);

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
  const input1 = memory([{ id: 0 }], ["id", "asc"]);
  const input2 = memory([{ id: 0, ref: 2 }], ["id", "asc"]);
  const joined = join(input1, "id", input2, "ref", "item");

  const spy = mock();
  joined.connect(spy);

  const anyArray = expect.any(Array);

  // Only left
  joined.push([[{ id: 1 }], [1]], undefined);
  expect(spy).not.toHaveBeenCalled();
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([[{ id: 1, item: [] }], [1], anyArray]);

  // Only right
  joined.push(undefined, [[{ id: 1, ref: 1 }], [1]]);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([[], [], anyArray]);

  // Left with source join
  joined.push([[{ id: 2 }], [1]], undefined);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 2, item: [{ id: 0, ref: 2 }] }],
    [1],
    anyArray,
  ]);

  // Right with source join
  joined.push(undefined, [[{ id: 1, ref: 0 }], [1]]);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 0, item: [{ id: 1, ref: 0 }] }],
    [0],
    anyArray,
  ]);

  // Join between deltas
  joined.push([[{ id: 3 }], [1], [0]], [[{ id: 1, ref: 3 }], [1], [0]]);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 3, item: [{ id: 1, ref: 3 }] }],
    [1],
    anyArray,
  ]);

  // Cross-join between deltas and source
  joined.push(
    [[{ id: 2 }], [1], [0]],
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
    anyArray,
  ]);

  // Empty left join
  joined.push(
    [[], [], []],
    [
      [
        { id: 3, ref: 2 },
        { id: 4, ref: 0 },
      ],
      [1, 1],
      [0],
    ],
  );
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 0, item: [{ id: 4, ref: 0 }] }],
    [0],
    anyArray,
  ]);

  // Empty right join
  joined.push([[{ id: 2 }], [1], [0]], [[], [], []]);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 2, item: [{ id: 0, ref: 2 }] }],
    [1],
    anyArray,
  ]);

  joined.push(undefined, undefined);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([[], [], anyArray]);
});
