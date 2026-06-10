import type { CLSet } from "../../datastructure/clset";
import { shape } from "../../datastructure/shape";
import { channel } from "../network/channel";
import { expect, it, mock } from "bun:test";
import { source } from "./source";
import { sqlite } from "./sqlite";
import SQLite from "bun:sqlite";
import { sink } from "../sink";
import { sync } from "./sync";

it("syncs across channels", async () => {
  const name = crypto.randomUUID();
  const db = new SQLite(":memory:");

  const note = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    likes: t.INT,
  }));
  type Note = (typeof note)["~type"];

  const [tx1, rx1] = channel<CLSet<Note>>(new BroadcastChannel(name));
  const [reconcile1, replicate1] = sync(note, sqlite(db, "notes_meta_1"));
  const notes1 = source(note, sqlite(db, "notes_1"))(reconcile1(rx1()));
  using _tx1 = tx1(replicate1(notes1.local));

  const [tx2, rx2] = channel<CLSet<Note>>(new BroadcastChannel(name));
  const [reconcile2, replicate2] = sync(note, sqlite(db, "notes_meta_2"));
  const notes2 = source(note, sqlite(db, "notes_2"))(reconcile2(rx2()));
  using _tx2 = tx2(replicate2(notes2.local));

  using view1 = sink(notes1);
  using view2 = sink(notes2);

  notes1.create({ id: 1, text: "hello", likes: 0 }).flush();
  expect(view1.pull()[0]).toEqual([{ id: 1, text: "hello", likes: 0 }]);

  await new Promise((r) => setTimeout(r));

  expect(view2.pull()[0]).toEqual([{ id: 1, text: "hello", likes: 0 }]);
  expect(db.query("SELECT * FROM notes_2").all()).toEqual([
    { id: 1, text: "hello", likes: 0 },
  ]);

  notes2.update({ id: 1, likes: 1 }).flush();
  expect(view2.pull()[0]).toEqual([{ id: 1, text: "hello", likes: 1 }]);

  await new Promise((r) => setTimeout(r));

  expect(view1.pull()[0]).toEqual([{ id: 1, text: "hello", likes: 1 }]);
  expect(db.query("SELECT * FROM notes_1").all()).toEqual([
    { id: 1, text: "hello", likes: 1 },
  ]);
});

it("stores changes and pulls them by version", () => {
  const db = new SQLite(":memory:");
  const note = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    likes: t.INT,
  }));

  const [reconcile, replicate] = sync(note, sqlite(db, "notes_meta"));
  const remote = reconcile();
  const notes = source(note, sqlite(db, "notes"))(remote);

  const stream = replicate(notes.local);

  notes.create({ id: 1, text: "hello", likes: 0 });
  notes.flush();

  expect(db.query("SELECT * FROM notes").all()).toEqual([
    { id: 1, text: "hello", likes: 0 },
  ]);

  expect(db.query("SELECT * FROM notes_meta").all()).toEqual([
    {
      pk_id: 1,
      version: 1,
      causality: 1,
      clock_text: 0,
      clock_likes: 0,
    },
  ]);

  notes.update({ id: 1, likes: 1 });
  notes.flush();

  expect(stream.pull({ version: 1 })).toEqual([
    [{ id: 1, text: "hello", likes: 1 }],
    [[2, 1, 0, 65536]],
    note,
  ]);

  remote.push([[{ id: 1, text: "hmm", likes: 2 }], [[2, 1, 65536, 0]], note]);
  remote.flush();

  expect(db.query("SELECT * FROM notes").all()).toEqual([
    { id: 1, text: "hmm", likes: 1 },
  ]);
});

it("does not replicate reconciled remote changes", () => {
  const db = new SQLite(":memory:");
  const note = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    likes: t.INT,
  }));

  const [reconcile, replicate] = sync(note, sqlite(db, "notes_meta"));
  const incoming = reconcile();
  const notes = source(note, sqlite(db, "notes"))(incoming);
  const outgoing = replicate(notes.local);
  const spy = mock();

  outgoing.connect(spy);

  incoming.push([[{ id: 1, text: "remote", likes: 0 }], [[1, 1, 0, 0]], note]);
  incoming.flush();

  expect(db.query("SELECT * FROM notes").all()).toEqual([
    { id: 1, text: "remote", likes: 0 },
  ]);
  expect(spy).not.toHaveBeenCalled();
});

it("creates, updates and deletes items", () => {
  const db = new SQLite(":memory:");
  const note = shape((t) => ({
    id: t(t.DOUBLE, t.PRIMARY),
    text: t.STRING,
    likes: t.INT,
  }));

  const notes = source(note, sqlite(db, "notes"))();
  sync(note, sqlite(db, "notes_meta"))[1](notes);

  const view = sink(notes);
  view.preload();

  notes.create(
    { id: 2, text: "bye", likes: 0 },
    { id: 1, text: "hello", likes: 0 },
    { id: 3, text: "world", likes: 0 },
  );
  notes.flush();

  {
    const data = db
      .query<(typeof note)["~type"], []>("SELECT * FROM notes")
      .all();
    expect(view.pull()[0]).toEqual(data);
    expect(data).toEqual([
      { id: 1, text: "hello", likes: 0 },
      { id: 2, text: "bye", likes: 0 },
      { id: 3, text: "world", likes: 0 },
    ]);
    expect(db.query("SELECT * FROM notes_meta").all()).toEqual([
      { pk_id: 1, version: 1, causality: 1, clock_text: 0, clock_likes: 0 },
      { pk_id: 2, version: 1, causality: 1, clock_text: 0, clock_likes: 0 },
      { pk_id: 3, version: 1, causality: 1, clock_text: 0, clock_likes: 0 },
    ]);
  }

  notes.update({ id: 1, likes: 1 }, { id: 2, text: "goodbye" });
  notes.flush();

  {
    const data = db
      .query<(typeof note)["~type"], []>("SELECT * FROM notes")
      .all();
    expect(view.pull()[0]).toEqual(data);
    expect(data).toEqual([
      { id: 1, text: "hello", likes: 1 },
      { id: 2, text: "goodbye", likes: 0 },
      { id: 3, text: "world", likes: 0 },
    ]);
    expect(db.query("SELECT * FROM notes_meta ORDER BY pk_id").all()).toEqual([
      { pk_id: 1, version: 2, causality: 1, clock_text: 0, clock_likes: 65536 },
      { pk_id: 2, version: 2, causality: 1, clock_text: 65536, clock_likes: 0 },
      { pk_id: 3, version: 1, causality: 1, clock_text: 0, clock_likes: 0 },
    ]);
  }

  notes.delete({ id: 3 }, { id: 2 });
  notes.flush();

  {
    const data = db
      .query<(typeof note)["~type"], []>("SELECT * FROM notes")
      .all();
    expect(view.pull()[0]).toEqual(data);
    expect(data).toEqual([{ id: 1, text: "hello", likes: 1 }]);
    expect(db.query("SELECT * FROM notes_meta ORDER BY pk_id").all()).toEqual([
      { pk_id: 1, version: 2, causality: 1, clock_text: 0, clock_likes: 65536 },
      { pk_id: 2, version: 3, causality: 2, clock_text: 0, clock_likes: 0 },
      { pk_id: 3, version: 3, causality: 2, clock_text: 0, clock_likes: 0 },
    ]);
  }
});
