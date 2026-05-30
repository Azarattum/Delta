import { create, remove, update, type ZSet } from "../../datastructure/zset";
import { expect, expectTypeOf, it, mock } from "bun:test";
import { shape } from "../../datastructure/shape";
import { source } from "./source";
import { sqlite } from "./sqlite";
import SQLite from "bun:sqlite";

it("executes and collapses actions", () => {
  const db = new SQLite(":memory:");

  const note = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    likes: t.INT,
  }));
  const items = source(note, sqlite(db, "test"))();

  const spy = mock();
  items.local.connect(spy);

  items.create({ id: 0, text: "initial", likes: 0 });
  items.flush();

  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 0, text: "initial", likes: 0 }],
    [create(note)],
    note,
  ]);

  items.update({ id: 0, likes: 42 });
  items.flush();

  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 0, text: "initial", likes: 42 }],
    [update(note, "likes")],
    note,
  ]);

  items.update({ id: 0, likes: 42 });
  items.flush();

  expect(spy).toHaveBeenLastCalledWith([[], [], note]);

  items.delete({ id: 0 });
  items.flush();

  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 0, text: "initial", likes: 42 }],
    [remove(note)],
    note,
  ]);

  items.create({ id: 1, text: "hello", likes: 0 });
  items.update({ id: 1, text: "hello 2" });
  items.flush();

  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 1, text: "hello 2", likes: 0 }],
    [create(note)],
    note,
  ]);

  items.update({ id: 2, text: "bye 2" });
  items.create({ id: 2, text: "bye", likes: 0 });
  items.flush();

  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 2, text: "bye", likes: 0 }],
    [create(note)],
    note,
  ]);

  items.create({ id: 3, text: "hey", likes: 0 });
  items.delete({ id: 3 });
  items.flush();

  expect(spy).toHaveBeenLastCalledWith([[], [], note]);

  items.delete({ id: 3 });
  items.create({ id: 3, text: "hey", likes: 0 });
  items.flush();

  expect(spy).toHaveBeenLastCalledWith([[], [], note]);

  items.delete({ id: 2 });
  items.update({ id: 2, likes: 1 });
  items.flush();

  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 2, text: "bye", likes: 0 }],
    [remove(note)],
    note,
  ]);
});

it("respects async and sync queries", () => {
  const asyncDB = () => ({ mutate: () => {}, query: async () => [] });
  const syncDB = () => ({ mutate: () => {}, query: () => [] });

  const nothing = shape(() => ({}));

  {
    const items = source(nothing, asyncDB)();
    expectTypeOf(items.pull).returns.toEqualTypeOf<Promise<ZSet<{}>>>();
    expectTypeOf(items.local.pull).returns.toEqualTypeOf<Promise<ZSet<{}>>>();
  }
  {
    const items = source(nothing, syncDB)();
    expectTypeOf(items.pull).returns.toEqualTypeOf<ZSet<{}>>();
    expectTypeOf(items.local.pull).returns.toEqualTypeOf<ZSet<{}>>();
  }
});

it("respects async and sync initializations", () => {
  const asyncDB = async () => ({ mutate: () => {}, query: () => [] });
  const syncDB = () => ({ mutate: () => {}, query: () => [] });

  const nothing = shape(() => ({}));

  {
    const store = source(nothing, asyncDB)();
    expectTypeOf(store).toExtend<Promise<unknown>>(); // TODO: fix this type
    expect(store).toBeInstanceOf(Promise);
  }
  {
    const store = source(nothing, syncDB)();
    expectTypeOf(store).not.toExtend<Promise<unknown>>();
    expect(store).not.toBeInstanceOf(Promise);
  }
});
