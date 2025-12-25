import { join, order, sink } from "..";
import { shape, type Order } from "../../datastructure/shape";
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
  await users.flush();
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

  // TODO: test with range operator
  // const windowedMessages = range(messagesByUser, limit(3, 1));
  // expect(windowedMessages.pull()[0]).toEqual([
  //   { id: 2, text: "And I'm Alice!", user: 1 },
  //   { id: 4, text: "Nice to meet you!", user: 1 },
  //   { id: 0, text: "Hello", user: 0 },
  // ]);
});

it("supports cursor pagination with composite order", () => {
  const triple = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    x: t.INT,
    y: t.INT,
    z: t.INT,
  }));

  const triples = sqlite(db, "triples", triple, [
    { id: 0, x: 0, y: 10, z: 0 },
    { id: 1, x: 0, y: 10, z: 5 },
    { id: 2, x: 0, y: 5, z: 2 },
    { id: 3, x: 1, y: 9, z: 1 },
    { id: 4, x: 1, y: 9, z: 4 },
    { id: 5, x: 1, y: 7, z: 3 },
    { id: 6, x: 2, y: 3, z: 0 },
  ]);

  const order: Order<(typeof triple)["~type"]> = [
    ["x", "asc"],
    ["y", "desc"],
    ["z", "asc"],
  ];

  const [afterAnchor] = triples.pull({
    cursor: {
      anchor: { x: 0, y: 10, z: 5 },
      offset: 0,
      count: 3,
      exclusive: true,
    },
    order,
  });
  expect(afterAnchor.map((row) => row.id)).toEqual([2, 3, 4]);

  const [skippedFromStart] = triples.pull({
    cursor: { offset: 2, count: 2 },
    order,
  });
  expect(skippedFromStart.map((row) => row.id)).toEqual([2, 3]);

  const [reverseRows] = triples.pull({
    cursor: { anchor: { x: 1, y: 9, z: 1 }, count: -2, exclusive: true },
    order,
  });
  expect(reverseRows.map((row) => row.id)).toEqual([1, 2]);

  const [reverseFromStart] = triples.pull({
    cursor: { offset: 1, count: -2 },
    order,
  });
  expect(reverseFromStart.map((row) => row.id)).toEqual([4, 5]);
});

it("supports skips in composite pagination", () => {
  const triple = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    x: t.INT,
    y: t.INT,
    z: t.INT,
  }));

  const triples = sqlite(db, "triples2", triple, [
    { id: 0, x: 0, y: 10, z: 0 },
    { id: 1, x: 0, y: 10, z: 5 },
    { id: 2, x: 0, y: 5, z: 2 },
    { id: 3, x: 1, y: 9, z: 1 },
    { id: 4, x: 1, y: 9, z: 4 },
    { id: 5, x: 1, y: 7, z: 3 },
    { id: 6, x: 2, y: 3, z: 0 },
  ]);

  const order: Order<(typeof triple)["~type"]> = [
    ["x", "asc"],
    ["y", "desc"],
    ["z", "asc"],
  ];

  const [afterAnchor] = triples.pull({
    cursor: {
      anchor: { x: 0, y: 10, z: 5 },
      exclusive: true,
      offset: 0,
      count: 3,
      skip: [
        { x: 0, y: 4, z: 0 },
        { x: 0, y: 4, z: 1 },
        { x: 0, y: 4, z: 2 },
      ],
    },
    order,
  });
  expect(afterAnchor.map((row) => row.id)).toEqual([2]);

  const [skippedFromStart] = triples.pull({
    cursor: {
      offset: 2,
      count: 2,
      skip: [
        { x: 0, y: 4, z: 0 },
        { x: 0, y: 4, z: 1 },
        { x: 0, y: 4, z: 2 },
      ],
    },
    order,
  });
  expect(skippedFromStart.map((row) => row.id)).toEqual([2]);

  const [reverseRows] = triples.pull({
    // TODO: not sure if that works correctly
    cursor: {
      anchor: { x: 1, y: 9, z: 1 },
      count: -2,
      skip: [{ x: 0, y: 7, z: 0 }],
    },
    order,
  });
  expect(reverseRows.map((row) => row.id)).toEqual([2, 3]);

  const [reverseFromStart] = triples.pull({
    cursor: {
      offset: 1,
      count: -2,
      skip: [{ x: 1, y: 9, z: 5 }],
    },
    order,
  });
  expect(reverseFromStart.map((row) => row.id)).toEqual([5]);

  const [skippedBeforeStart] = triples.pull({
    cursor: { offset: 2, count: 2, skip: [{ x: 0, y: 5, z: 1 }] },
    order,
  });
  expect(skippedBeforeStart.map((row) => row.id)).toEqual([2]);
});

afterAll(async () => {
  await rm("test.db");
});
