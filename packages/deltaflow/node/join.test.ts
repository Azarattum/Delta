import { create, remove, update } from "../datastructure/zset";
import { join, memory, sink, nest, shape } from "..";
import { expect, mock, it } from "bun:test";

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
    const [data, meta, shape] = joined.pull();
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
    expect({ ...(meta as any) }).toEqual({
      0: create(userWithMessages),
      1: create(userWithMessages),
      messages: [[create(message), create(message)], [create(message)]],
    });
    expect(shape).toEqual(userWithMessages);
  }

  messages.push([
    [{ id: 4, text: "Nice to meet you!", user: 1 }],
    [create(message)],
    message,
  ]);
  {
    const [data, meta, shape] = joined.pull();
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
    expect({ ...(meta as any) }).toEqual({
      0: create(userWithMessages),
      1: create(userWithMessages),
      messages: [
        [create(message), create(message)],
        [create(message), create(message)],
      ],
    });
    expect(shape).toEqual(userWithMessages);
  }

  users.push([[{ id: 2, name: "Emily" }], [create(user)], user]);
  {
    const [data, meta, shape] = joined.pull();
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
    expect({ ...(meta as any) }).toEqual({
      0: create(userWithMessages),
      1: create(userWithMessages),
      2: create(userWithMessages),
      messages: [
        [create(message), create(message)],
        [create(message), create(message)],
        [create(message)],
      ],
    });
    expect(shape).toEqual(userWithMessages);
  }

  messages.push([
    [
      { id: 1, text: "I'm Bob", user: 0 }, // Delete message
      { id: 3, text: "I am here!", user: 2 }, // Edit message
    ],
    [remove(message), update(message, "text")],
    message,
  ]);
  {
    const [data, meta, shape] = joined.pull();
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
    expect({ ...(meta as any) }).toEqual({
      0: create(userWithMessages),
      1: create(userWithMessages),
      2: create(userWithMessages),
      messages: [
        [create(message)],
        [create(message), create(message)],
        [create(message)],
      ],
    });
    expect(shape).toEqual(userWithMessages);
  }

  messages.push([
    [
      { id: 4, text: "Nice to meet you!", user: 1 }, // Move Alice's message to Emily
      { id: 4, text: "Nice to meet you!", user: 2 },
    ],
    // Updating relationship keys or primary keys is not allowed! (using remove/add instead)
    [remove(message), create(message)],
    message,
  ]);
  {
    const [data, meta, shape] = joined.pull();
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
    expect({ ...(meta as any) }).toEqual({
      0: create(userWithMessages),
      1: create(userWithMessages),
      2: create(userWithMessages),
      messages: [
        [create(message)],
        [create(message)],
        [create(message), create(message)],
      ],
    });
    expect(shape).toEqual(userWithMessages);
  }
});

it("joins changes correctly", () => {
  const parent = shape((t) => ({ id: t(t.INT, t.PRIMARY) }));
  const child = shape((t) => ({ id: t.PRIMARY, ref: t.INT }));
  // TODO: pulls from sources should return correct order
  // const both = nest(parent, "item", reorder(child, "ref"));
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
  joined.push([[{ id: 1 }], [create(parent)], parent], undefined);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 1, item: [] }],
    [create(both)],
    both,
  ]);

  // Only right
  joined.push(undefined, [[{ id: 1, ref: 1 }], [create(child)], child]);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([[], [], both]);

  // Left with source join
  joined.push([[{ id: 2 }], [create(parent)], parent], undefined);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 2, item: [{ id: 0, ref: 2 }] }],
    [create(both)],
    both,
  ]);

  // Right with source join
  joined.push(undefined, [[{ id: 1, ref: 0 }], [create(child)], child]);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 0, item: [{ id: 1, ref: 0 }] }],
    [update(both, "item")],
    both,
  ]);

  // Join between deltas
  joined.push(
    [[{ id: 3 }], [create(parent)], parent],
    [[{ id: 1, ref: 3 }], [create(child)], child],
  );
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 3, item: [{ id: 1, ref: 3 }] }],
    [create(both)],
    both,
  ]);

  // Cross-join between deltas and source
  joined.push(
    [[{ id: 2 }], [create(parent)], parent],
    [
      [
        { id: 3, ref: 2 },
        { id: 4, ref: 0 },
      ],
      [create(child), create(child)],
      child,
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
    [update(both, "item"), create(both)],
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
      [create(child), create(child)],
      child,
    ],
  );
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 0, item: [{ id: 4, ref: 0 }] }],
    [update(both, "item")],
    both,
  ]);

  // Empty right join
  joined.push([[{ id: 2 }], [create(parent)], parent], [[], [], child]);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 2, item: [{ id: 0, ref: 2 }] }],
    [create(both)],
    both,
  ]);

  joined.push(undefined, undefined);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([[], []]);
});

it("joins with foreign key updates", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    profile: t(t.RELATION(1), t.INT),
  }));
  const profile = shape((t) => ({
    id: t(t.INT, t.PRIMARY, t.RELATION(1)),
    bio: t.STRING,
  }));

  const users = memory(user, [
    { id: 0, profile: 0 },
    { id: 1, profile: 1 },
  ]);
  const profiles = memory(profile, [
    { id: 0, bio: "Zero" },
    { id: 1, bio: "One" },
    { id: 2, bio: "Two" },
  ]);

  const joined = join(users, "profile", profiles, "id", "profile", true);
  const userWithProfile = nest(user, "profile", profile, true);
  expect(joined.pull()[0]).toEqual([
    { id: 0, profile: { id: 0, bio: "Zero" } },
    { id: 1, profile: { id: 1, bio: "One" } },
  ]);

  const spy = mock();
  joined.connect(spy);

  users.push([[{ id: 1, profile: 1 }], [remove(user)], user]);
  users.push([[{ id: 1, profile: 2 }], [create(user)], user]);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [
      { id: 1, profile: 1 },
      { id: 1, profile: { id: 2, bio: "Two" } },
    ],
    [remove(userWithProfile), create(userWithProfile)],
    userWithProfile,
  ]);

  profiles.push([[{ id: 2, bio: "3" }], [create(profile)], profile]);
  profiles.push([[{ id: 2, bio: "2" }], [update(profile, "bio")], profile]);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 1, profile: { id: 2, bio: "2" } }],
    [0],
    userWithProfile,
  ]);

  users.push([[{ id: 2, profile: 3 }], [create(user)], user]);
  profiles.push([[{ id: 3, bio: "Three" }], [create(profile)], profile]);
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 2, profile: { id: 3, bio: "Three" } }],
    [create(userWithProfile)],
    userWithProfile,
  ]);

  expect(joined.pull()[0]).toEqual([
    { id: 0, profile: { id: 0, bio: "Zero" } },
    { id: 1, profile: { id: 2, bio: "2" } },
    { id: 2, profile: { id: 3, bio: "Three" } },
  ]);
});

it("propagates middle-level foreign key updates", () => {
  const A = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    b: t(t.RELATION(1), t.INT),
  }));
  const B = shape((t) => ({ id: t(t.INT, t.RELATION(1), t.PRIMARY) }));
  const C = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    b: t(t.RELATION(1), t.INT),
    x: t.STRING,
  }));

  const a = memory(A, [{ id: 1, b: 1 }]);
  const b = memory(B, [{ id: 1 }, { id: 2 }]);
  const c = memory(C, [
    { id: 10, b: 1, x: "x" },
    { id: 11, b: 2, x: "y" },
  ]);

  const bWithCs = join(b, "id", c, "b", "cs");
  const full = sink(join(a, "b", bWithCs, "id", "b", true));

  expect(full.pull()[0]).toEqual([
    { id: 1, b: { id: 1, cs: [{ id: 10, b: 1, x: "x" }] } },
  ]);

  c.push([[{ id: 10, b: 1, x: "x" }], [remove(C)], C]);
  c.push([[{ id: 10, b: 2, x: "x" }], [create(C)], C]);
  a.push([[{ id: 1, b: 1 }], [remove(A)], A]);
  a.push([[{ id: 1, b: 2 }], [create(A)], A]);

  const [data, meta] = full.pull();
  expect(data).toEqual([
    {
      id: 1,
      b: {
        id: 2,
        cs: [
          { id: 10, b: 2, x: "x" },
          { id: 11, b: 2, x: "y" },
        ],
      },
    },
  ]);
  expect(meta).toEqual([create(nest(A, "b", nest(B, "cs", C), true))]);
  expect(meta["b"]).toEqual([create(nest(B, "cs", C))]);
  expect(meta["b"].cs).toEqual([[create(C), create(C)]]);

  c.push([[{ id: 10, b: 2, x: "x" }], [remove(C)], C]);
  c.push([[{ id: 10, b: 1, x: "x" }], [create(C)], C]);
  expect(full.pull()[0]).toEqual([
    { id: 1, b: { id: 2, cs: [{ id: 11, b: 2, x: "y" }] } },
  ]);
});

it("sorts streams for join", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    user: t.INT,
  }));

  const users = memory(user);
  const messages = memory(message);
  const joined = join(users, "id", messages, "user", "messages");

  users.push([
    [
      { id: 0, name: "Alice" },
      { id: 1, name: "Bob" },
    ],
    [create(user), create(user)],
    user,
  ]);

  messages.push([
    [
      { id: 0, text: "I'm Bob", user: 1 },
      { id: 1, text: "I'm Alice", user: 0 },
    ],
    [create(message), create(message, 2)],
    message,
  ]);

  const spy = mock();
  joined.connect(spy);
  joined.flush();

  {
    const [data, meta, shape] = spy.mock.lastCall?.[0] ?? [];

    expect(data).toEqual([
      {
        id: 0,
        name: "Alice",
        messages: [{ id: 1, text: "I'm Alice", user: 0 }],
      },
      { id: 1, name: "Bob", messages: [{ id: 0, text: "I'm Bob", user: 1 }] },
    ]);

    expect({ ...meta }).toEqual({
      0: create(nest(user, "messages", message)),
      1: create(nest(user, "messages", message)),
      messages: [[create(message, 2)], [create(message)]],
    });

    expect(shape).toEqual(nest(user, "messages", message));
  }

  users.push([
    [
      { id: 3, name: "Dave" },
      { id: 2, name: "Clare" },
    ],
    [create(user), create(user)],
    user,
  ]);

  messages.push([
    [
      { id: 2, text: "I'm Clare", user: 2 },
      { id: 3, text: "I'm Dave", user: 3 },
    ],
    [create(message), create(message, 2)],
    message,
  ]);

  joined.flush();
  {
    const [data, meta, shape] = spy.mock.lastCall?.[0] ?? [];

    expect(data).toEqual([
      { id: 3, name: "Dave", messages: [{ id: 3, text: "I'm Dave", user: 3 }] },
      {
        id: 2,
        name: "Clare",
        messages: [{ id: 2, text: "I'm Clare", user: 2 }],
      },
    ]);

    expect({ ...meta }).toEqual({
      0: create(nest(user, "messages", message)),
      1: create(nest(user, "messages", message)),
      messages: [[create(message, 2)], [create(message)]],
    });

    expect(shape).toEqual(nest(user, "messages", message));
  }

  users.push([[{ id: 4, name: "Edward" }], [create(user)], user]);

  messages.push([
    [
      { id: 4, text: "I'm Edward", user: 4 },
      { id: 5, text: "Alice still here", user: 0 },
      { id: 6, text: "The Edward", user: 4 },
    ],
    [create(message), create(message), create(message)],
    message,
  ]);

  joined.flush();
  {
    const [data, meta, shape] = spy.mock.lastCall?.[0] ?? [];

    expect(data).toEqual([
      {
        id: 0,
        name: "Alice",
        messages: [{ id: 5, text: "Alice still here", user: 0 }],
      },
      {
        id: 4,
        name: "Edward",
        messages: [
          { id: 4, text: "I'm Edward", user: 4 },
          { id: 6, text: "The Edward", user: 4 },
        ],
      },
    ]);

    expect({ ...meta }).toEqual({
      0: update(nest(user, "messages", message), "messages"),
      1: create(nest(user, "messages", message)),
      messages: [[create(message)], [create(message), create(message)]],
    });

    expect(shape).toEqual(nest(user, "messages", message));
  }
});

it("joins with sync flush", async () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    user: t.INT,
  }));

  const users = memory(user);
  const messages = memory(message);
  const joined = join(users, "id", messages, "user", "messages");

  users.push([
    [
      { id: 0, name: "Alice" },
      { id: 1, name: "Bob" },
    ],
    [create(user), create(user)],
    user,
  ]);

  messages.push([
    [
      { id: 0, text: "I'm Bob", user: 1 },
      { id: 1, text: "I'm Alice", user: 0 },
    ],
    [create(message), create(message, 2)],
    message,
  ]);

  const spy = mock();
  joined.connect(spy);
  await new Promise((r) => setTimeout(r));

  {
    const [data, meta] = spy.mock.lastCall?.[0] ?? [];
    expect(data).toEqual([
      {
        id: 0,
        name: "Alice",
        messages: [{ id: 1, text: "I'm Alice", user: 0 }],
      },
      { id: 1, name: "Bob", messages: [{ id: 0, text: "I'm Bob", user: 1 }] },
    ]);
    expect({ ...(meta as any) }).toEqual({
      0: create(nest(user, "messages", message)),
      1: create(nest(user, "messages", message)),
      messages: [[create(message, 2)], [create(message)]],
    });
  }
  {
    expect(users.pull()).toEqual([
      [
        { id: 0, name: "Alice" },
        { id: 1, name: "Bob" },
      ],
      [create(user), create(user)],
      user,
    ]);
  }
});

it("handles deeply nested joins", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    user: t.INT,
  }));
  const comment = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    user: t.INT,
  }));
  const like = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    count: t.INT,
    comment: t.INT,
  }));

  const users = memory(user);
  const messages = memory(message);
  const comments = memory(comment);
  const likes = memory(like);

  const calls: any[] = [];
  const usersWithMessagesFn = mock((x) => calls.push(structuredClone(x)));
  const usersWithMessages = join(users, "id", messages, "user", "messages");
  usersWithMessages.connect(usersWithMessagesFn);

  const commentsWithLikesFn = mock((x) => calls.push(structuredClone(x)));
  const commentsWithLikes = join(
    comments,
    "id",
    likes,
    "comment",
    "likes",
    true,
  );
  commentsWithLikes.connect(commentsWithLikesFn);

  const fullFn = mock((x) => calls.push(structuredClone(x)));
  const full = join(
    usersWithMessages,
    "id",
    commentsWithLikes,
    "user",
    "comments",
  );
  full.connect(fullFn);

  users.push([[{ id: 1, name: "Alice" }], [create(user)], user]);
  users.push([[{ id: 0, name: "Bob" }], [create(user)], user]);

  comments.push([
    [{ id: 0, text: "First!", user: 1 }],
    [create(comment)],
    comment,
  ]);
  comments.push([
    [{ id: 1, text: "Great post!", user: 0 }],
    [create(comment)],
    comment,
  ]);

  likes.push([[{ id: 0, count: 2, comment: 0 }], [create(like)], like]);
  likes.push([[{ id: 1, count: 1, comment: 1 }], [create(like)], like]);

  messages.push([
    [
      { id: 0, text: "Hello", user: 0 },
      { id: 1, text: "I'm Bob", user: 0 },
      { id: 2, text: "And I'm Alice!", user: 1 },
      { id: 3, text: "I'll be here!", user: 2 },
    ],
    [create(message), create(message), create(message), create(message)],
    message,
  ]);

  expect(usersWithMessagesFn).not.toHaveBeenCalled();
  expect(commentsWithLikesFn).not.toHaveBeenCalled();
  expect(fullFn).not.toHaveBeenCalled();

  full.flush();

  expect(usersWithMessagesFn).toHaveBeenCalledTimes(1);
  expect(commentsWithLikesFn).toHaveBeenCalledTimes(1);
  expect(fullFn).toHaveBeenCalledTimes(1);

  expect(calls[0][0]).toEqual([
    {
      id: 0,
      text: "First!",
      user: 1,
      likes: { id: 0, count: 2, comment: 0 },
    },
    {
      id: 1,
      text: "Great post!",
      user: 0,
      likes: { id: 1, count: 1, comment: 1 },
    },
  ]);
  expect(calls[0][1]).toEqual([
    create(nest(comment, "likes", like, true)),
    create(nest(comment, "likes", like, true)),
  ]);
  expect(calls[0][1].likes).toEqual([create(like), create(like)]);

  expect(calls[1][0]).toEqual([
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
  expect(calls[1][1]).toEqual([
    create(nest(user, "messages", message)),
    create(nest(user, "messages", message)),
  ]);
  expect(calls[1][1].messages).toEqual([
    [create(message), create(message)],
    [create(message)],
  ]);

  expect(calls[2][0]).toEqual([
    {
      id: 0,
      name: "Bob",
      messages: [
        { id: 0, text: "Hello", user: 0 },
        { id: 1, text: "I'm Bob", user: 0 },
      ],
      comments: [
        {
          id: 1,
          text: "Great post!",
          user: 0,
          likes: { id: 1, count: 1, comment: 1 },
        },
      ],
    },
    {
      id: 1,
      name: "Alice",
      messages: [{ id: 2, text: "And I'm Alice!", user: 1 }],
      comments: [
        {
          id: 0,
          text: "First!",
          user: 1,
          likes: { id: 0, count: 2, comment: 0 },
        },
      ],
    },
  ]);
  expect(calls[2][1]).toEqual([
    create(
      nest(
        nest(user, "messages", message),
        "comments",
        nest(comment, "likes", like, true),
      ),
    ),
    create(
      nest(
        nest(user, "messages", message),
        "comments",
        nest(comment, "likes", like, true),
      ),
    ),
  ]);
  expect(calls[2][1].messages).toEqual([
    [create(message), create(message)],
    [create(message)],
  ]);
  expect(calls[2][1].comments).toEqual([
    [create(nest(comment, "likes", like, true))],
    [create(nest(comment, "likes", like, true))],
  ]);
  expect(calls[2][1].comments[0].likes).toEqual([create(like)]);
  expect(calls[2][1].comments[1].likes).toEqual([create(like)]);
});

it("updates nested chains", () => {
  const user = shape((t) => ({ id: t(t.INT, t.PRIMARY), name: t.STRING }));
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    user: t.INT,
    text: t.STRING,
  }));

  const users = memory(user, [
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);
  const messages = memory(message, [
    { id: 0, user: 0, text: "Hello" },
    { id: 1, user: 1, text: "Hi" },
  ]);

  const joined = sink(join(users, "id", messages, "user", "messages"));
  expect(joined.pull()[0]).toEqual([
    { id: 0, name: "Bob", messages: [{ id: 0, user: 0, text: "Hello" }] },
    { id: 1, name: "Alice", messages: [{ id: 1, user: 1, text: "Hi" }] },
  ]);

  users.push([[{ id: 0, name: "BOB" }], [update(user, "name")], user]);
  expect(joined.pull()[0]).toEqual([
    { id: 0, name: "BOB", messages: [{ id: 0, user: 0, text: "Hello" }] },
    { id: 1, name: "Alice", messages: [{ id: 1, user: 1, text: "Hi" }] },
  ]);

  messages.push([
    [{ id: 2, user: 0, text: "there" }],
    [create(message)],
    message,
  ]);
  expect(joined.pull()[0]).toEqual([
    {
      id: 0,
      name: "BOB",
      messages: [
        { id: 0, user: 0, text: "Hello" },
        { id: 2, user: 0, text: "there" },
      ],
    },
    { id: 1, name: "Alice", messages: [{ id: 1, user: 1, text: "Hi" }] },
  ]);

  messages.push([
    [{ id: 2, user: 0, text: "there!" }],
    [update(message, "text")],
    message,
  ]);
  expect(joined.pull()[0]).toEqual([
    {
      id: 0,
      name: "BOB",
      messages: [
        { id: 0, user: 0, text: "Hello" },
        { id: 2, user: 0, text: "there!" },
      ],
    },
    { id: 1, name: "Alice", messages: [{ id: 1, user: 1, text: "Hi" }] },
  ]);
});

it("handles join key parent updates", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    msg: t(t.RELATION(1), t.INT),
    name: t.STRING,
  }));
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    user: t(t.INT, t.RELATION(1)),
    text: t.STRING,
  }));

  const users = memory(user, [{ id: 0, name: "Bob", msg: 0 }]);
  const messages = memory(message, [
    { id: 0, user: 0, text: "Hello" },
    { id: 1, user: 1, text: "Hi" },
  ]);

  const joined = sink(join(users, "msg", messages, "user", "messages"));
  expect(joined.pull()[0]).toEqual([
    {
      id: 0,
      name: "Bob",
      msg: 0,
      messages: [{ id: 0, user: 0, text: "Hello" }],
    },
  ]);

  users.push([[{ id: 0, name: "Bob", msg: 0 }], [remove(user)], user]);
  users.push([[{ id: 0, name: "Bob", msg: 1 }], [create(user)], user]);
  expect(joined.pull()[0]).toEqual([
    { id: 0, name: "Bob", msg: 1, messages: [{ id: 1, user: 1, text: "Hi" }] },
  ]);
});

it("handles join key child updates", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    msg: t(t.INT, t.RELATION(1)),
    name: t.STRING,
  }));
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    user: t(t.INT, t.RELATION(1)),
    text: t.STRING,
  }));

  const users = memory(user, [{ id: 0, name: "Bob", msg: 0 }]);
  const messages = memory(message, [
    { id: 0, user: 0, text: "Hello" },
    { id: 1, user: 1, text: "Hi" },
  ]);

  const joined = sink(join(users, "msg", messages, "user", "messages"));
  expect(joined.pull()[0]).toEqual([
    {
      id: 0,
      name: "Bob",
      msg: 0,
      messages: [{ id: 0, user: 0, text: "Hello" }],
    },
  ]);

  messages.push([
    [{ id: 0, user: 0, text: "Hello" }],
    [remove(message)],
    message,
  ]);
  messages.push([
    [{ id: 0, user: 1, text: "Hello" }],
    [create(message)],
    message,
  ]);
  expect(joined.pull()[0]).toEqual([
    { id: 0, name: "Bob", msg: 0, messages: [] },
  ]);
});

it("handles multiple simultaneous join key updates", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    msg: t(t.RELATION(1), t.INT),
    name: t.STRING,
  }));
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    user: t(t.RELATION(1), t.INT),
    text: t.STRING,
  }));

  const users = memory(user, [
    { id: 0, name: "Alice", msg: 0 },
    { id: 1, name: "Bob", msg: 1 },
  ]);
  const messages = memory(message, [
    { id: 0, user: 0, text: "Hello" },
    { id: 1, user: 1, text: "Hi" },
  ]);

  const joined = sink(join(users, "msg", messages, "user", "messages"));
  joined.pull();

  messages.push([
    [{ id: 0, user: 0, text: "Hello" }],
    [remove(message)],
    message,
  ]);
  messages.push([
    [{ id: 0, user: 2, text: "Hello" }],
    [create(message)],
    message,
  ]);
  messages.push([[{ id: 1, user: 1, text: "Hi" }], [remove(message)], message]);
  messages.push([[{ id: 1, user: 0, text: "Hi" }], [create(message)], message]);

  expect(joined.pull()[0]).toEqual([
    {
      id: 0,
      name: "Alice",
      msg: 0,
      messages: [{ id: 1, user: 0, text: "Hi" }],
    },
    { id: 1, name: "Bob", msg: 1, messages: [] },
  ]);
});

it("handles chained join key updates correctly", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    msg: t(t.RELATION(1), t.INT),
    name: t.STRING,
  }));
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    user: t(t.RELATION(1), t.INT),
    text: t.STRING,
  }));

  const users = memory(user, [{ id: 0, name: "Alice", msg: 0 }]);
  const messages = memory(message, [
    { id: 0, user: 0, text: "Hello" },
    { id: 1, user: 1, text: "Hi" },
    { id: 2, user: 2, text: "Hey" },
  ]);

  const joined = sink(join(users, "msg", messages, "user", "messages"));
  joined.pull();

  // Update user's msg 0 -> 1 -> 2 in sequence
  users.push([[{ id: 0, name: "Alice", msg: 0 }], [remove(user)], user]);
  users.push([[{ id: 0, name: "Alice", msg: 1 }], [create(user)], user]);
  users.push([[{ id: 0, name: "Alice", msg: 1 }], [remove(user)], user]);
  users.push([[{ id: 0, name: "Alice", msg: 2 }], [create(user)], user]);

  const result = joined.pull()[0];
  expect(result).toEqual([
    {
      id: 0,
      name: "Alice",
      msg: 2,
      messages: [{ id: 2, user: 2, text: "Hey" }],
    },
  ]);
});

it("handles empty join with key updates", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    msg: t(t.RELATION(1), t.INT),
    name: t.STRING,
  }));
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    user: t(t.INT, t.RELATION(1)),
    text: t.STRING,
  }));

  const users = memory(user, [{ id: 0, name: "Alice", msg: 99 }]);
  const messages = memory(message, [{ id: 0, user: 0, text: "Hello" }]);

  const joined = sink(join(users, "msg", messages, "user", "messages"));
  expect(joined.pull()[0]).toEqual([
    { id: 0, name: "Alice", msg: 99, messages: [] },
  ]);

  users.push([[{ id: 0, name: "Alice", msg: 99 }], [remove(user)], user]);
  users.push([[{ id: 0, name: "Alice", msg: 0 }], [create(user)], user]);

  expect(joined.pull()[0]).toEqual([
    {
      id: 0,
      name: "Alice",
      msg: 0,
      messages: [{ id: 0, user: 0, text: "Hello" }],
    },
  ]);
});
