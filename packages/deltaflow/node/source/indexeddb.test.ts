import { createStore, indexeddb } from "./indexeddb";
import { shape } from "../../datastructure/shape";
import type { MaybePromise } from "../../stream";
import { expect, it } from "bun:test";
import { mock } from "bun:test";
import { join, order, sink } from "..";

import "fake-indexeddb/auto";
import "typotest";

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

  const idbRequest = indexedDB.open("test1", 1);
  idbRequest.onupgradeneeded = () => {
    createStore(idbRequest.result, "users", user);
    createStore(idbRequest.result, "messages", message);
  };

  const db = await new Promise<IDBDatabase>(
    (r) => (idbRequest.onsuccess = () => r(idbRequest.result)),
  );

  const users = await indexeddb(db, "users", user, [
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);
  const messages = await indexeddb(db, "messages", message, [
    { id: 0, text: "Hello", user: 0 },
    { id: 1, text: "I'm Bob", user: 0 },
    { id: 2, text: "And I'm Alice!", user: 1 },
    { id: 3, text: "I'll be here!", user: 2 },
  ]);

  expect(users.flush).toHaveReturnTypeOf<MaybePromise<void>>();
  expect(messages.flush).toHaveReturnTypeOf<MaybePromise<void>>();

  const joined = sink(join(users, "id", messages, "user", "messages"));

  expect(joined.flush).toHaveReturnTypeOf<MaybePromise<void>>();
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

  messages.push([[{ id: 4, text: "Nice to meet you!", user: 1 }], [1]]);
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

  users.push([[{ id: 2, name: "Emily" }], [1]]);
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

  // Parent updates are synchronous
  users.push([[{ id: 2, name: "Emilia" }], [0]]);
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

  // Children updates still need an async flush to retrieve its parent node
  // TODO: think if we can work around this
  messages.push([[{ id: 4, text: "I'm glad to meet you!", user: 1 }], [0]]);
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

it("pushes synchronously when possible", async () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));

  const idbRequest = indexedDB.open("test2", 1);
  idbRequest.onupgradeneeded = () => {
    createStore(idbRequest.result, "users", user);
  };

  const db = await new Promise<IDBDatabase>(
    (r) => (idbRequest.onsuccess = () => r(idbRequest.result)),
  );

  const users = await indexeddb(db, "users", user, [
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);

  const view = sink(users);

  expect(users.flush).toHaveReturnTypeOf<MaybePromise<void>>();

  expect(view.pull()[0]).toHaveLength(0);
  await view.preload();
  expect(view.pull()[0]).toEqual([
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);

  users.push([[{ id: 2, name: "Emily" }], [1]]);
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
  users.push([[{ id: 3, name: "John" }], [1]]);
  expect(spy).not.toHaveBeenCalled();
  const promise = view.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [
      { id: 0, name: "Bob" },
      { id: 1, name: "Alice" },
      { id: 2, name: "Emily" },
      { id: 3, name: "John" },
    ],
    [1, 1, 1, 1],
    user,
  ]);
  expect(promise).toBeInstanceOf(Promise);
  await promise;
});

it("subscribes and handles pushes", async () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY, t.RELATION(1)),
    name: t.STRING,
  }));

  const idbRequest = indexedDB.open("test3", 1);
  idbRequest.onupgradeneeded = () => {
    createStore(idbRequest.result, "users", user);
  };

  const db = await new Promise<IDBDatabase>(
    (r) => (idbRequest.onsuccess = () => r(idbRequest.result)),
  );

  const users = await indexeddb(db, "users", user, [
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);

  const view = sink(users);

  const spy = mock();
  view.subscribe(spy);
  users.push([[{ id: 2, name: "John" }], [1]]);

  expect(spy).toHaveBeenLastCalledWith([[], []]);

  await view.preload();

  expect(spy).toHaveBeenLastCalledWith([
    [
      { id: 0, name: "Bob" },
      { id: 1, name: "Alice" },
      { id: 2, name: "John" },
    ],
    [1, 1, 1],
    user,
  ]);
});

it("pulls with constraints", async () => {
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    user: t(t.INT, t.RELATION(1)),
  }));

  const idbRequest = indexedDB.open("test4", 1);
  idbRequest.onupgradeneeded = () => {
    createStore(idbRequest.result, "messages", message, ["text"]);
  };

  const db = await new Promise<IDBDatabase>(
    (r) => (idbRequest.onsuccess = () => r(idbRequest.result)),
  );

  const messages = await indexeddb(db, "messages", message, [
    { id: 0, text: "Hello", user: 0 },
    { id: 1, text: "I'm Bob", user: 1 },
    { id: 2, text: "And I'm Alice!", user: 2 },
    { id: 3, text: "I'll be here!", user: 3 },
    { id: 4, text: "I'm Bob too", user: 1 },
  ]);

  {
    const result = await messages.pull({
      constraints: { id: new Set([1, 2]) },
    });

    expect(result[0]).toEqual([
      { id: 1, text: "I'm Bob", user: 1 },
      { id: 2, text: "And I'm Alice!", user: 2 },
    ]);
  }

  {
    const result = await messages.pull({
      constraints: { user: new Set([1, 2]) },
    });

    expect(result[0]).toEqual([
      { id: 1, text: "I'm Bob", user: 1 },
      { id: 4, text: "I'm Bob too", user: 1 },
      { id: 2, text: "And I'm Alice!", user: 2 },
    ]);
  }

  {
    const result = await messages.pull({
      constraints: { text: new Set(["Hello", "Non-existent"]) },
    });

    expect(result[0]).toEqual([{ id: 0, text: "Hello", user: 0 }]);
  }
});

it("writes to indexeddb", async () => {
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
  }));

  const idbRequest = indexedDB.open("test5", 1);
  idbRequest.onupgradeneeded = () => {
    createStore(idbRequest.result, "messages", message, ["text"]);
  };

  const db = await new Promise<IDBDatabase>(
    (r) => (idbRequest.onsuccess = () => r(idbRequest.result)),
  );

  const messages = await indexeddb(db, "messages", message);

  {
    messages.push([[{ id: 0, text: "Hello" }], [1]]);
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
    messages.push([[{ id: 0, text: "Hi" }], [0]]);
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
    messages.push([[{ id: 0, text: "Hi" }], [-1]]);
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
