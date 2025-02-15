import { expect, it, mock } from "bun:test";
import { stream } from "./stream";
import { filter, join, map, memory, sink } from "./nodes";

it("streams lazily", () => {
  const source = stream({ pull: mock(() => 123), push: () => 0 })();
  const noop = stream<number>({});
  const node = noop(source);

  expect(source.pull).not.toHaveBeenCalled();
  node.pull();
  expect(source.pull).toHaveBeenCalledTimes(1);
});

it("performs basic CRUD", () => {
  const users = memory([
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);
  users.pull = mock(users.pull);
  const predicate = mock((x) => x.name.startsWith("A"));
  const view = sink(filter(users, predicate));

  // Read
  expect(predicate).not.toHaveBeenCalled();
  expect(view.pull()).toEqual([[{ id: 1, name: "Alice" }], [1]]);
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
  ]);

  // Delete
  users.push([[{ id: 1, name: "Alice" }], [-1]]);
  expect(view.pull()).toEqual([[{ id: 2, name: "Alex" }], [1]]);

  // Update
  users.push([[{ id: 2, name: "Alexandra" }], [0]]);
  expect(view.pull()).toEqual([[{ id: 2, name: "Alexandra" }], [1]]);

  expect(users.pull).toHaveBeenCalledTimes(1);
  expect(users.pull()).toEqual([
    [
      { id: 0, name: "Bob" },
      { id: 2, name: "Alexandra" },
    ],
    [1, 1],
  ]);
});

it("updates children", () => {
  type User = { id: number; name: string; children?: User[] };

  const users = memory<User>([
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);

  // Create
  users.push([
    [{ id: 1, name: "Alice", children: [{ id: 3, name: "Clara" }] }],
    Object.assign([0], { children: [[1]] }),
  ]);
  {
    const [data, metadata] = users.pull();
    expect(data).toEqual([
      { id: 0, name: "Bob" },
      { id: 1, name: "Alice", children: [{ id: 3, name: "Clara" }] },
    ]);
    expect({ ...metadata } as any).toEqual({
      0: 1,
      1: 1,
      children: [undefined, [1]],
    });
  }

  // Create one more
  users.push([
    [{ id: 1, name: "Alice", children: [{ id: 4, name: "Kate" }] }],
    Object.assign([0], { children: [[1]] }),
  ]);
  {
    const [data, metadata] = users.pull();
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
  }

  // Update
  users.push([
    [{ id: 1, name: "Alice", children: [{ id: 4, name: "Katelyn" }] }],
    Object.assign([0], { children: [[0]] }),
  ]);
  {
    const [data, metadata] = users.pull();
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
    const [data, metadata] = users.pull();
    expect(data).toEqual([
      { id: 0, name: "Bob", children: [{ id: 5, name: "Hank" }] },
      { id: 1, name: "Alice", children: [{ id: 4, name: "Katelyn" }] },
    ]);
    expect({ ...metadata } as any).toEqual({
      0: 1,
      1: 1,
      children: [[1], [1]],
    });
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
    const [data, metadata] = users.pull();
    expect(data).toEqual([
      { id: 0, name: "Bob", children: [] },
      { id: 1, name: "Alice", children: [] },
    ]);
    expect({ ...metadata } as any).toEqual({
      0: 1,
      1: 1,
      children: [[], []],
    });
  }
});

it("joins streams", () => {
  const users = memory([
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);
  const messages = memory([
    { id: 0, text: "Hello", user: 0 },
    { id: 1, text: "I'm Bob", user: 0 },
    { id: 2, text: "And I'm Alice!", user: 1 },
    { id: 3, text: "I'll be here!", user: 2 },
  ]);

  const joined = sink(join(users, "id", messages, "user", "messages"));

  {
    const [data, metadata] = joined.pull();
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
  }

  messages.push([[{ id: 4, text: "Nice to meet you!", user: 1 }], [1]]);
  {
    const [data, metadata] = joined.pull();
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
  }

  users.push([[{ id: 2, name: "Emily" }], [1]]);
  {
    const [data, metadata] = joined.pull();
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
  }

  messages.push([
    [
      { id: 1, text: "I'm Bob", user: 0 }, // Delete message
      { id: 3, text: "I am here!", user: 2 }, // Edit message
    ],
    [-1, 0],
  ]);
  {
    const [data, metadata] = joined.pull();
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
    const [data, metadata] = joined.pull();
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
  }
});

it("processes full pipeline", () => {
  const users = memory([
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);
  const messages = memory([
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
        (x) => ((x.user = 0), x),
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
    const [data, metadata] = view.pull();
    expect(data).toEqual([
      {
        id: 0,
        name: "BOB",
        messages: [
          { id: 1, text: "I'm Bob" },
          { id: 2, text: "And I'm Alice!" },
          { id: 3, text: "I'll be here!" },
        ],
      },
    ]);
    expect({ ...(metadata as any) }).toEqual({
      0: 1,
      messages: [[1, 1, 1]],
    });
  }

  users.push([[{ id: 2, name: "Clara" }], [1]]);
  {
    const [data, metadata] = view.pull();
    expect(data).toEqual([
      {
        id: 0,
        name: "BOB",
        messages: [
          { id: 1, text: "I'm Bob" },
          { id: 2, text: "And I'm Alice!" },
          { id: 3, text: "I'll be here!" },
        ],
      },
      { id: 2, name: "CLARA", messages: [] },
    ]);
    expect({ ...(metadata as any) }).toEqual({
      0: 1,
      1: 1,
      messages: [[1, 1, 1], []],
    });
  }

  messages.push([[{ id: 4, text: "Bob steals all messages!", user: 2 }], [1]]);
  {
    const [data, metadata] = view.pull();
    expect(data).toEqual([
      {
        id: 0,
        name: "BOB",
        messages: [
          { id: 1, text: "I'm Bob" },
          { id: 2, text: "And I'm Alice!" },
          { id: 3, text: "I'll be here!" },
          { id: 4, text: "Bob steals all messages!" },
        ],
      },
      { id: 2, name: "CLARA", messages: [] },
    ]);
    expect({ ...(metadata as any) }).toEqual({
      0: 1,
      1: 1,
      messages: [[1, 1, 1, 1], []],
    });
  }

  expect(flowing).toHaveBeenLastCalledWith([
    [
      {
        id: 0,
        name: "BOB",
        messages: [
          {
            id: 4,
            text: "Bob steals all messages!",
          },
        ],
      },
    ],
    [0],
  ]);
});
