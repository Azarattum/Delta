import { expect, it } from "bun:test";
import { mock } from "bun:test";
import { shape } from "../../datastructure/shape";
import { createStore, indexeddb } from "./indexeddb";
import { join, sink } from "..";

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

  expect(users.flush).toHaveReturnTypeOf<Promise<void>>();
  expect(messages.flush).toHaveReturnTypeOf<Promise<void>>();

  const joined = sink(join(users, "id", messages, "user", "messages"));

  expect(joined.flush).toHaveReturnTypeOf<Promise<void>>();

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
      messages: [{ id: 2, text: "And I'm Alice!", user: 1 }],
    },
  ]);

  messages.push([[{ id: 4, text: "Nice to meet you!", user: 1 }], [1]]);
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

  expect(users.flush).toHaveReturnTypeOf<Promise<void>>();

  expect(view.pull()[0]).toHaveLength(0);
  await view.flush();
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
