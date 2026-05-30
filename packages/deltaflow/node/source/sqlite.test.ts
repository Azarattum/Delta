import { shape, type Order } from "../../datastructure/shape";
import { join, limit, order, range, sink } from "..";
import { update } from "../../datastructure/zset";
import { expect, it } from "bun:test";
import { source } from "./source";
import { sqlite } from "./sqlite";
import SQLite from "bun:sqlite";

type Note = {
  id: number;
  title: string;
  body: string;
};

it("applies creates, sparse updates, and removes in one transaction", () => {
  const db = new SQLite(":memory:");
  const store = sqlite<Note>(db, "notes")(
    ["id", "title", "body"],
    [0, 2, 2],
    ["id"],
    [],
  );

  store.mutate({
    creates: [
      { id: 1, title: "Ada", body: "first" },
      { id: 2, title: "Grace", body: "second" },
    ],
    updates: [],
    removes: [],
  });

  db.run(`
    CREATE TRIGGER notes_body_guard
    BEFORE UPDATE OF body ON notes
    BEGIN
      SELECT RAISE(ABORT, 'body touched');
    END
  `);

  store.mutate({
    creates: [{ id: 3, title: "Linus", body: "third" }],
    updates: [{ id: 1, title: "Ada Lovelace" }],
    removes: [{ id: 2 }],
  });

  expect(db.query("SELECT * FROM notes ORDER BY id").all()).toEqual([
    { id: 1, title: "Ada Lovelace", body: "first" },
    { id: 3, title: "Linus", body: "third" },
  ]);
});

it("rolls back the whole mutation batch on failure", () => {
  const db = new SQLite(":memory:");
  const store = sqlite<Note>(db, "notes")(
    ["id", "title", "body"],
    [0, 2, 2],
    ["id"],
    [],
  );

  store.mutate({
    creates: [
      { id: 1, title: "Ada", body: "first" },
      { id: 2, title: "Grace", body: "second" },
    ],
    updates: [],
    removes: [],
  });

  expect(() =>
    store.mutate({
      creates: [{ id: 2, title: "Partial" } as any],
      updates: [{ id: 1, title: "Should Roll Back" }],
      removes: [{ id: 1 }],
    }),
  ).toThrow();

  expect(db.query("SELECT * FROM notes ORDER BY id").all()).toEqual([
    { id: 1, title: "Ada", body: "first" },
    { id: 2, title: "Grace", body: "second" },
  ]);
});

it("works through datastore", () => {
  const db = new SQLite(":memory:");
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));

  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    user: t.INT,
  }));

  const users = source(user, sqlite(db, "users"))();
  const messages = source(message, sqlite(db, "messages"))();

  users.create({ id: 0, name: "Bob" }, { id: 1, name: "Alice" }).flush();
  messages
    .create(
      { id: 0, text: "Hello", user: 0 },
      { id: 1, text: "I'm Bob", user: 0 },
      { id: 2, text: "And I'm Alice!", user: 1 },
      { id: 3, text: "I'll be here!", user: 2 },
    )
    .flush();

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

  messages.create({ id: 4, text: "Nice to meet you!", user: 1 }).flush();
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

  users.create({ id: 2, name: "Emily" }).flush();
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

it("supports cursor pagination with composite order", () => {
  const db = new SQLite(":memory:");
  const triple = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    x: t.INT,
    y: t.INT,
    z: t.INT,
  }));

  const triples = source(triple, sqlite(db, "triples"))();
  triples
    .create(
      { id: 0, x: 0, y: 10, z: 0 },
      { id: 1, x: 0, y: 10, z: 5 },
      { id: 2, x: 0, y: 5, z: 2 },
      { id: 3, x: 1, y: 9, z: 1 },
      { id: 4, x: 1, y: 9, z: 4 },
      { id: 5, x: 1, y: 7, z: 3 },
      { id: 6, x: 2, y: 3, z: 0 },
    )
    .flush();

  const sortOrder: Order<(typeof triple)["~type"]> = [
    ["x", "asc"],
    ["y", "desc"],
    ["z", "asc"],
  ];

  const [afterAnchor] = triples.pull({
    cursor: {
      anchor: { id: 1, x: 0, y: 10, z: 5 },
      offset: 0,
      count: 3,
      exclusive: true,
    },
    order: sortOrder,
  });
  expect(afterAnchor.map((row) => row.id)).toEqual([2, 3, 4]);

  const [skippedFromStart] = triples.pull({
    cursor: { offset: 2, count: 2 },
    order: sortOrder,
  });
  expect(skippedFromStart.map((row) => row.id)).toEqual([2, 3]);

  const [reverseRows] = triples.pull({
    cursor: {
      anchor: { id: 3, x: 1, y: 9, z: 1 },
      count: -2,
      exclusive: true,
    },
    order: sortOrder,
  });
  expect(reverseRows.map((row) => row.id)).toEqual([1, 2]);

  const [reverseWithOffset] = triples.pull({
    cursor: {
      anchor: { id: 3, x: 1, y: 9, z: 1 },
      offset: 1,
      count: -2,
      exclusive: true,
    },
    order: sortOrder,
  });
  expect(reverseWithOffset.map((row) => row.id)).toEqual([0, 1]);

  const [reverseFromStart] = triples.pull({
    cursor: { offset: 1, count: -2 },
    order: sortOrder,
  });
  expect(reverseFromStart.map((row) => row.id)).toEqual([4, 5]);
});

it("updates only changed columns through datastore", () => {
  const db = new SQLite(":memory:");
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
    email: t.STRING,
  }));

  const users = source(user, sqlite(db, "field_mask_users"))();
  users
    .create(
      { id: 0, name: "Ada", email: "a@example.com" },
      { id: 1, name: "Grace", email: "g@example.com" },
    )
    .flush();

  db.run(`
    CREATE TRIGGER field_mask_email_guard
    BEFORE UPDATE OF email ON field_mask_users
    BEGIN
      SELECT RAISE(ABORT, 'email touched');
    END
  `);

  users.push([
    [{ id: 1, name: "Grace Hopper", email: "ignored@example.com" }],
    [update(user, "name")],
    user,
  ]);
  users.flush();

  expect(
    db.query("SELECT id, name, email FROM field_mask_users ORDER BY id").all(),
  ).toEqual([
    { id: 0, name: "Ada", email: "a@example.com" },
    { id: 1, name: "Grace Hopper", email: "g@example.com" },
  ]);
});
