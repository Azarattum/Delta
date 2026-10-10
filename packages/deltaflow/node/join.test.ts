import { create, remove, update } from "../datastructure/zset";
import { join, memory, sink, nest, shape, source } from "..";
import { expect, mock, it } from "bun:test";

it("joins streams", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    user: t(t.INT, t.RELATION(1)),
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

  messages.create({ id: 4, text: "Nice to meet you!", user: 1 });
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

  users.create({ id: 2, name: "Emily" });
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

  messages.delete({ id: 1 }).update({ id: 3, text: "I am here!" });
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

  // Move Alice's message to Emily
  messages.update({ id: 4, user: 2 });
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

it("moves multiple children between parents in one flush", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    user: t(t.INT, t.RELATION(1)),
  }));

  const users = source(user, memory())();
  users
    .create(
      { id: 0, name: "Alice" },
      { id: 1, name: "Bob" },
      { id: 2, name: "Emily" },
    )
    .flush();

  const messages = source(message, memory())();
  messages
    .create(
      { id: 0, text: "First", user: 0 },
      { id: 1, text: "Second", user: 1 },
    )
    .flush();

  const joined = sink(join(users, "id", messages, "user", "messages"));
  joined.pull();

  messages.update({ id: 0, user: 1 }, { id: 1, user: 2 });

  expect(joined.pull()[0]).toEqual([
    { id: 0, name: "Alice", messages: [] },
    { id: 1, name: "Bob", messages: [{ id: 0, text: "First", user: 1 }] },
    { id: 2, name: "Emily", messages: [{ id: 1, text: "Second", user: 2 }] },
  ]);
});

it("joins changes correctly", () => {
  const parent = shape((t) => ({ id: t(t.INT, t.PRIMARY) }));
  const child = shape((t) => ({ id: t(t.INT, t.PRIMARY), ref: t.INT }));
  const both = nest(parent, "item", child);

  const input1 = source(parent, memory())();
  input1.create({ id: 0 }).flush();
  const input2 = source(child, memory())();
  input2.create({ id: 0, ref: 2 }).flush();
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

  const users = source(user, memory())();
  users.create({ id: 0, profile: 0 }, { id: 1, profile: 1 }).flush();
  const profiles = source(profile, memory())();
  profiles
    .create(
      { id: 0, bio: "Zero" },
      { id: 1, bio: "One" },
      { id: 2, bio: "Two" },
    )
    .flush();

  const joined = join(users, "profile", profiles, "id", "profile", true);
  const userWithProfile = nest(user, "profile", profile, true);
  expect(joined.pull()[0]).toEqual([
    { id: 0, profile: { id: 0, bio: "Zero" } },
    { id: 1, profile: { id: 1, bio: "One" } },
  ]);

  const spy = mock();
  joined.connect(spy);

  users.update({ id: 1, profile: 2 });
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [
      { id: 1, profile: 1 },
      { id: 1, profile: { id: 2, bio: "Two" } },
    ],
    Object.assign([remove(userWithProfile), create(userWithProfile)], {
      profile: [, create(profile)],
    }),
    userWithProfile,
  ]);

  profiles.update({ id: 2, bio: "2" });
  joined.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 1, profile: { id: 2, bio: "2" } }],
    Object.assign([0], { profile: [update(profile, "bio")] }),
    userWithProfile,
  ]);

  users.create({ id: 2, profile: 3 });
  profiles.create({ id: 3, bio: "Three" });
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

  const a = source(A, memory())();
  a.create({ id: 1, b: 1 }).flush();
  const b = source(B, memory())();
  b.create({ id: 1 }, { id: 2 }).flush();
  const c = source(C, memory())();
  c.create({ id: 10, b: 1, x: "x" }, { id: 11, b: 2, x: "y" }).flush();

  const bWithCs = join(b, "id", c, "b", "cs");
  const full = sink(join(a, "b", bWithCs, "id", "b", true));

  expect(full.pull()[0]).toEqual([
    { id: 1, b: { id: 1, cs: [{ id: 10, b: 1, x: "x" }] } },
  ]);

  c.update({ id: 10, b: 2 });
  a.update({ id: 1, b: 2 });

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

  c.update({ id: 10, b: 1 });
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

  const users = source(user, memory())();
  const messages = source(message, memory())();
  const joined = join(users, "id", messages, "user", "messages");

  users.create({ id: 0, name: "Alice" }, { id: 1, name: "Bob" });

  messages.create(
    { id: 0, text: "I'm Bob", user: 1 },
    { id: 1, text: "I'm Alice", user: 0 },
  );

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
      messages: [[create(message)], [create(message)]],
    });

    expect(shape).toEqual(nest(user, "messages", message));
  }

  users.create({ id: 3, name: "Dave" }, { id: 2, name: "Clare" });
  messages.create(
    { id: 2, text: "I'm Clare", user: 2 },
    { id: 3, text: "I'm Dave", user: 3 },
  );

  joined.flush();
  {
    const [data, meta, shape] = spy.mock.lastCall?.[0] ?? [];

    expect(data).toEqual([
      {
        id: 2,
        name: "Clare",
        messages: [{ id: 2, text: "I'm Clare", user: 2 }],
      },
      { id: 3, name: "Dave", messages: [{ id: 3, text: "I'm Dave", user: 3 }] },
    ]);

    expect({ ...meta }).toEqual({
      0: create(nest(user, "messages", message)),
      1: create(nest(user, "messages", message)),
      messages: [[create(message)], [create(message)]],
    });

    expect(shape).toEqual(nest(user, "messages", message));
  }

  users.create({ id: 4, name: "Edward" });
  messages.create(
    { id: 4, text: "I'm Edward", user: 4 },
    { id: 5, text: "Alice still here", user: 0 },
    { id: 6, text: "The Edward", user: 4 },
  );

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

  const users = source(user, memory())();
  const messages = source(message, memory())();
  const joined = join(users, "id", messages, "user", "messages");

  users.create({ id: 0, name: "Alice" }, { id: 1, name: "Bob" });
  messages.create(
    { id: 0, text: "I'm Bob", user: 1 },
    { id: 1, text: "I'm Alice", user: 0 },
  );

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
      messages: [[create(message)], [create(message)]],
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

  const users = source(user, memory())();
  const messages = source(message, memory())();
  const comments = source(comment, memory())();
  const likes = source(like, memory())();

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

  users.create({ id: 1, name: "Alice" }, { id: 0, name: "Bob" });
  comments.create(
    { id: 0, text: "First!", user: 1 },
    { id: 1, text: "Great post!", user: 0 },
  );
  likes.create(
    { id: 0, count: 2, comment: 0 },
    { id: 1, count: 1, comment: 1 },
  );
  messages.create(
    { id: 0, text: "Hello", user: 0 },
    { id: 1, text: "I'm Bob", user: 0 },
    { id: 2, text: "And I'm Alice!", user: 1 },
    { id: 3, text: "I'll be here!", user: 2 },
  );

  expect(usersWithMessagesFn).not.toHaveBeenCalled();
  expect(commentsWithLikesFn).not.toHaveBeenCalled();
  expect(fullFn).not.toHaveBeenCalled();

  full.flush();

  expect(usersWithMessagesFn).toHaveBeenCalledTimes(1);
  expect(commentsWithLikesFn).toHaveBeenCalledTimes(1);
  expect(fullFn).toHaveBeenCalledTimes(1);

  expect(calls[1][0]).toEqual([
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
  expect(calls[1][1]).toEqual([
    create(nest(comment, "likes", like, true)),
    create(nest(comment, "likes", like, true)),
  ]);
  expect(calls[1][1].likes).toEqual([create(like), create(like)]);

  expect(calls[0][0]).toEqual([
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
  expect(calls[0][1]).toEqual([
    create(nest(user, "messages", message)),
    create(nest(user, "messages", message)),
  ]);
  expect(calls[0][1].messages).toEqual([
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

  const users = source(user, memory())();
  users.create({ id: 0, name: "Bob" }, { id: 1, name: "Alice" }).flush();
  const messages = source(message, memory())();
  messages
    .create({ id: 0, user: 0, text: "Hello" }, { id: 1, user: 1, text: "Hi" })
    .flush();

  const joined = sink(join(users, "id", messages, "user", "messages"));
  expect(joined.pull()[0]).toEqual([
    { id: 0, name: "Bob", messages: [{ id: 0, user: 0, text: "Hello" }] },
    { id: 1, name: "Alice", messages: [{ id: 1, user: 1, text: "Hi" }] },
  ]);

  users.update({ id: 0, name: "BOB" });
  expect(joined.pull()[0]).toEqual([
    { id: 0, name: "BOB", messages: [{ id: 0, user: 0, text: "Hello" }] },
    { id: 1, name: "Alice", messages: [{ id: 1, user: 1, text: "Hi" }] },
  ]);

  messages.create({ id: 2, user: 0, text: "there" });
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

  messages.update({ id: 2, text: "there!" });
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

  const users = source(user, memory())();
  users.create({ id: 0, name: "Bob", msg: 0 }).flush();
  const messages = source(message, memory())();
  messages
    .create({ id: 0, user: 0, text: "Hello" }, { id: 1, user: 1, text: "Hi" })
    .flush();

  const joined = sink(join(users, "msg", messages, "user", "messages"));
  expect(joined.pull()[0]).toEqual([
    {
      id: 0,
      name: "Bob",
      msg: 0,
      messages: [{ id: 0, user: 0, text: "Hello" }],
    },
  ]);

  users.update({ id: 0, msg: 1 });
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

  const users = source(user, memory())();
  users.create({ id: 0, name: "Bob", msg: 0 }).flush();
  const messages = source(message, memory())();
  messages
    .create({ id: 0, user: 0, text: "Hello" }, { id: 1, user: 1, text: "Hi" })
    .flush();

  const joined = sink(join(users, "msg", messages, "user", "messages"));
  expect(joined.pull()[0]).toEqual([
    {
      id: 0,
      name: "Bob",
      msg: 0,
      messages: [{ id: 0, user: 0, text: "Hello" }],
    },
  ]);

  messages.update({ id: 0, user: 1 });
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

  const users = source(user, memory())();
  users
    .create({ id: 0, name: "Alice", msg: 0 }, { id: 1, name: "Bob", msg: 1 })
    .flush();
  const messages = source(message, memory())();
  messages
    .create({ id: 0, user: 0, text: "Hello" }, { id: 1, user: 1, text: "Hi" })
    .flush();

  const joined = sink(join(users, "msg", messages, "user", "messages"));
  joined.pull();

  messages.update({ id: 0, user: 2 }, { id: 1, user: 0 });

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

  const users = source(user, memory())();
  users.create({ id: 0, name: "Alice", msg: 0 }).flush();
  const messages = source(message, memory())();
  messages
    .create(
      { id: 0, user: 0, text: "Hello" },
      { id: 1, user: 1, text: "Hi" },
      { id: 2, user: 2, text: "Hey" },
    )
    .flush();

  const joined = sink(join(users, "msg", messages, "user", "messages"));
  joined.pull();

  // Update user's msg 0 -> 1 -> 2 in sequence
  users.update({ id: 0, msg: 1 }).update({ id: 0, msg: 2 });

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

  const users = source(user, memory())();
  users.create({ id: 0, name: "Alice", msg: 99 }).flush();
  const messages = source(message, memory())();
  messages.create({ id: 0, user: 0, text: "Hello" }).flush();

  const joined = sink(join(users, "msg", messages, "user", "messages"));
  expect(joined.pull()[0]).toEqual([
    { id: 0, name: "Alice", msg: 99, messages: [] },
  ]);

  users.update({ id: 0, msg: 0 });

  expect(joined.pull()[0]).toEqual([
    {
      id: 0,
      name: "Alice",
      msg: 0,
      messages: [{ id: 0, user: 0, text: "Hello" }],
    },
  ]);
});
