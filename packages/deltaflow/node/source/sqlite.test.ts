import { join, limit, order, range, sink } from "..";
import { shape } from "../../datastructure/shape";
import { it, expect, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import { sqlite } from "./sqlite";
import SQLite from "bun:sqlite";

const db = new SQLite("test.db");

it("works with sqlite", async () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));

  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    user: t.INT,
  }));

  const users = sqlite(db, "users", user, [
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);

  const messages = sqlite(db, "messages", message, [
    { id: 0, text: "Hello", user: 0 },
    { id: 1, text: "I'm Bob", user: 0 },
    { id: 2, text: "And I'm Alice!", user: 1 },
    { id: 3, text: "I'll be here!", user: 2 },
  ]);

  const joined = sink(join(users, "id", messages, "user", "messages"));
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

  const messagesByUser = order(messages, ["user", "desc"]);
  expect(messagesByUser.pull()[0]).toEqual([
    { id: 3, text: "I'll be here!", user: 2 },
    { id: 2, text: "And I'm Alice!", user: 1 },
    { id: 4, text: "Nice to meet you!", user: 1 },
    { id: 0, text: "Hello", user: 0 },
    { id: 1, text: "I'm Bob", user: 0 },
  ]);

  const windowedMessages = range(messagesByUser, limit(3, 1));
  expect(windowedMessages.pull()[0]).toEqual([
    { id: 2, text: "And I'm Alice!", user: 1 },
    { id: 4, text: "Nice to meet you!", user: 1 },
    { id: 0, text: "Hello", user: 0 },
  ]);
});

afterAll(async () => {
  await rm("test.db");
});
