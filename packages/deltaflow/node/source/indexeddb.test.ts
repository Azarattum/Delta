import { expect, expectTypeOf, it } from "bun:test";
import { create } from "../../datastructure/zset";
import { shape } from "../../datastructure/shape";
import type { MaybePromise } from "../../stream";
import { indexeddb } from "./indexeddb";
import { join, order, sink, map } from "..";
import { source } from "./source";
import { mock } from "bun:test";

import "fake-indexeddb/auto";

it("works with indexed DB", async () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY, t.RELATION(1)),
    name: t.STRING,
  }));

  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    user: t(t.INT, t.RELATION(1)),
  }));

  const users = await source(user, indexeddb("test1", "users"))();
  await users.create({ id: 0, name: "Bob" }, { id: 1, name: "Alice" }).flush();

  const messages = await source(message, indexeddb("test1", "messages"))();
  await messages
    .create(
      { id: 0, text: "Hello", user: 0 },
      { id: 1, text: "I'm Bob", user: 0 },
      { id: 2, text: "And I'm Alice!", user: 1 },
      { id: 3, text: "I'll be here!", user: 2 },
    )
    .flush();

  expectTypeOf(users.flush).returns.toEqualTypeOf<MaybePromise<void>>();
  expectTypeOf(messages.flush).returns.toEqualTypeOf<MaybePromise<void>>();

  const joined = sink(join(users, "id", messages, "user", "messages"));

  expectTypeOf(joined.flush).returns.toEqualTypeOf<MaybePromise<void>>();
  expect(joined.flush()).toBe(undefined);

  await joined.preload();
  expect(joined.pull()[0]).toEqual([
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

  messages.create({ id: 4, text: "Nice to meet you!", user: 1 });
  await expect(joined.flush()).resolves.toBe(undefined);
  expect(joined.pull()[0]).toEqual([
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

  users.create({ id: 2, name: "Emily" });
  await joined.flush();
  expect(joined.pull()[0]).toEqual([
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

  users.update({ id: 2, name: "Emilia" });
  await joined.flush();
  expect(joined.pull()[0]).toEqual([
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
      name: "Emilia",
      messages: [{ id: 3, text: "I'll be here!", user: 2 }],
    },
  ]);

  messages.update({ id: 4, text: "I'm glad to meet you!" });
  await joined.flush();
  expect(joined.pull()[0]).toEqual([
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
        { id: 4, text: "I'm glad to meet you!", user: 1 },
      ],
    },
    {
      id: 2,
      name: "Emilia",
      messages: [{ id: 3, text: "I'll be here!", user: 2 }],
    },
  ]);

  const messagesByUser = order(messages, ["user", "desc"]);
  expect((await messagesByUser.pull())[0]).toEqual([
    { id: 3, text: "I'll be here!", user: 2 },
    { id: 4, text: "I'm glad to meet you!", user: 1 },
    { id: 2, text: "And I'm Alice!", user: 1 },
    { id: 1, text: "I'm Bob", user: 0 },
    { id: 0, text: "Hello", user: 0 },
  ]);
});

it("pushes unsafe changes synchronously when possible", async () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));

  const users = await source(user, indexeddb("test2", "users"))();
  await users.create({ id: 0, name: "Bob" }, { id: 1, name: "Alice" }).flush();

  const view = sink(users);

  expectTypeOf(users.flush).returns.toEqualTypeOf<MaybePromise<void>>();

  expect(view.pull()[0]).toHaveLength(0);
  await view.preload();
  expect(view.pull()[0]).toEqual([
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);

  users.createUnsafe({ id: 2, name: "Emily" });
  expect(view.pull()[0]).toEqual([
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
    { id: 2, name: "Emily" },
  ]);

  expect((await users.pull())[0]).toEqual([
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
    { id: 2, name: "Emily" },
  ]);

  const spy = mock();
  view.connect(spy);
  expect(spy).not.toHaveBeenCalled();
  users.createUnsafe({ id: 3, name: "John" });
  expect(spy).not.toHaveBeenCalled();
  const promise = view.flush();
  expect(promise).toBeInstanceOf(Promise);
  expect(spy).toHaveBeenLastCalledWith([
    [
      { id: 0, name: "Bob" },
      { id: 1, name: "Alice" },
      { id: 2, name: "Emily" },
      { id: 3, name: "John" },
    ],
    [create(user), create(user), create(user), create(user)],
    user,
  ]);
  await promise;

  users.updateUnsafe([
    { id: 3, name: "John" },
    { id: 3, name: "Jonathan" },
  ]);
  const updatePromise = users.flush();
  expect(view.pull()[0]).toEqual([
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
    { id: 2, name: "Emily" },
    { id: 3, name: "Jonathan" },
  ]);
  await updatePromise;
  expect((await users.pull())[0]).toEqual([
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
    { id: 2, name: "Emily" },
    { id: 3, name: "Jonathan" },
  ]);

  users.deleteUnsafe({ id: 3, name: "Jonathan" });
  const deletePromise = users.flush();
  expect(view.pull()[0]).toEqual([
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
    { id: 2, name: "Emily" },
  ]);
  await deletePromise;
  expect((await users.pull())[0]).toEqual([
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
    { id: 2, name: "Emily" },
  ]);
});

it("subscribes and handles pushes", async () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY, t.RELATION(1)),
    name: t.STRING,
  }));

  const users = await source(user, indexeddb("test3", "users"))();
  await users.create({ id: 0, name: "Bob" }, { id: 1, name: "Alice" }).flush();

  const view = sink(users);

  const spy = mock();
  view.subscribe(spy);
  users.create({ id: 2, name: "John" });

  expect(spy).toHaveBeenLastCalledWith([[], []]);
  await users.flush();

  expect(spy).toHaveBeenLastCalledWith([
    [
      { id: 0, name: "Bob" },
      { id: 1, name: "Alice" },
      { id: 2, name: "John" },
    ],
    [create(user), create(user), create(user)],
    user,
  ]);
});

it("pulls with constraints", async () => {
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    user: t(t.INT, t.RELATION(1)),
  }));

  const messages = await source(message, indexeddb("test4", "messages"))();
  await messages
    .create(
      { id: 0, text: "Hello", user: 0 },
      { id: 1, text: "I'm Bob", user: 1 },
      { id: 2, text: "And I'm Alice!", user: 2 },
      { id: 3, text: "I'll be here!", user: 3 },
      { id: 4, text: "I'm Bob too", user: 1 },
    )
    .flush();

  {
    const result = await messages.pull({
      cursor: { anchor: { id: 2 }, exclusive: true },
    });
    expect(result[0].map(({ id }) => id)).toEqual([3, 4]);
  }

  {
    const result = await messages.pull({ cursor: { count: 0 } });
    expect(result[0]).toEqual([]);
  }

  {
    const result = await messages.pull({
      filter: [{ keys: [["id"]], items: [] }],
    });
    expect(result[0]).toEqual([]);
  }

  {
    const result = await messages.pull({ cursor: { offset: 1, count: 2 } });
    expect(result[0].map(({ id }) => id)).toEqual([1, 2]);
  }

  {
    const result = await messages.pull({
      cursor: {
        anchor: { id: 3 },
        offset: 1,
        count: -2,
        exclusive: true,
      },
    });
    expect(result[0].map(({ id }) => id)).toEqual([0, 1]);
  }

  {
    const result = await messages.pull({
      filter: [{ keys: [["id"]], items: [{ id: 1 }, { id: 2 }] }],
    });

    expect(result[0]).toEqual([
      { id: 1, text: "I'm Bob", user: 1 },
      { id: 2, text: "And I'm Alice!", user: 2 },
    ]);
  }

  {
    const result = await messages.pull({
      filter: [{ keys: [["user"]], items: [{ user: 1 }, { user: 2 }] }],
    });

    expect(result[0]).toEqual([
      { id: 1, text: "I'm Bob", user: 1 },
      { id: 4, text: "I'm Bob too", user: 1 },
      { id: 2, text: "And I'm Alice!", user: 2 },
    ]);
  }

  {
    const result = await messages.pull({
      filter: [
        {
          keys: [["user"], ["ref"]],
          items: [{ ref: 0 }, { ref: 4 }],
        },
      ],
    });

    expect(result[0]).toEqual([{ id: 0, text: "Hello", user: 0 }]);
  }
});

it("writes to indexeddb", async () => {
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
  }));

  const messages = await source(message, indexeddb("test5", "messages"))();

  const request = indexedDB.open("test5");
  const db = await new Promise<IDBDatabase>((resolve) => {
    request.onsuccess = () => resolve(request.result);
  });

  {
    messages.create({ id: 0, text: "Hello" });
    await messages.flush();

    const stored = await new Promise((resolve) => {
      db
        .transaction("messages", "readwrite")
        .objectStore("messages")
        .getAll().onsuccess = ({ target }) => resolve((target as any).result);
    });

    expect(stored).toEqual([{ id: 0, text: "Hello" }]);
  }
  {
    messages.update({ id: 0, text: "Hi" });
    await messages.flush();

    const stored = await new Promise((resolve) => {
      db
        .transaction("messages", "readwrite")
        .objectStore("messages")
        .getAll().onsuccess = ({ target }) => resolve((target as any).result);
    });

    expect(stored).toEqual([{ id: 0, text: "Hi" }]);
  }
  {
    messages.delete({ id: 0 });
    await messages.flush();

    const stored = await new Promise((resolve) => {
      db
        .transaction("messages", "readwrite")
        .objectStore("messages")
        .getAll().onsuccess = ({ target }) => resolve((target as any).result);
    });

    expect(stored).toEqual([]);
  }
});

it("retains write values across downstream mutation and asynchronous storage", async () => {
  const file = shape((t) => ({
    id: t(t.PRIMARY, t.INT),
    name: t.STRING,
  }));

  const files = await source(file, indexeddb(crypto.randomUUID(), "files"))();
  const view = sink(
    map(files, (file) => {
      file.name = file.name.toUpperCase();
      return file;
    }),
  );

  const preloaded = await view.preload();
  expect(view.pull()).toBe(preloaded);
  const [data] = preloaded;

  await files.create({ id: 1, name: "Alice" }).flush();
  expect(data[0].name).toBe("ALICE");
  expect((await files.pull())[0][0].name).toBe("Alice");

  await files.update({ id: 1, name: "Bob" }).flush();
  expect(data[0].name).toBe("BOB");
  expect(view.pull()).toBe(preloaded);
  expect((await files.pull())[0][0].name).toBe("Bob");
});
