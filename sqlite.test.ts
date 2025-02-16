import { it, expect, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import { join, sink } from "./nodes";
import { sqlite } from "./sqlite";
import SQLite from "bun:sqlite";

const db = new SQLite("test.db");

it("works with sqlite", async () => {
  const users = sqlite(db, "users", [
    { id: 0, name: "Bob" },
    { id: 1, name: "Alice" },
  ]);
  const messages = sqlite(db, "messages", [
    { id: 0, text: "Hello", user: 0 },
    { id: 1, text: "I'm Bob", user: 0 },
    { id: 2, text: "And I'm Alice!", user: 1 },
    { id: 3, text: "I'll be here!", user: 2 },
  ]);

  const joined = sink(
    join(users, "id", messages, "user", "messages"),
    (a, b) => a.id - b.id,
  );
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
});

afterAll(async () => {
  await rm("test.db");
});
