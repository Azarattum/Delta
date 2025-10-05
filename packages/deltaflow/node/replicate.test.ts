import { fork, memory, memoryReplication, replicate, shape, sink } from "..";
import { it, mock, expect } from "bun:test";

it("converts ZSet to CLSet", async () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
    age: t.INT,
  }));

  const users = memory(user, [
    { id: 0, name: "Bob", age: 17 },
    { id: 1, name: "Alice", age: 22 },
  ]);

  const global = { version: 1, peer: 42 };
  const meta = memoryReplication(users, global, [
    [0, [1, 1, 1, global.peer, 1, global.peer]],
  ]);

  // TODO: consider forking before pushing to users,
  //  to avoid z2cl node when receiving changes in a full pipeline
  //  this would mean we would want some kind of `input` node

  // Fork changes to copy them to 2 streams
  const [users1, users2] = fork(users);
  const changes = replicate(users1, meta, global);
  const view = sink(users2);

  // Materialize view
  view.pull();

  const spy = mock();
  changes.connect(spy);
  expect(spy).not.toHaveBeenCalled();

  users.push([[{ id: 2, name: "Eve", age: 20 }], [1]]);
  expect(spy).not.toHaveBeenCalled();
  changes.flush();
  expect(spy).toHaveBeenLastCalledWith([
    [{ id: 2, name: "Eve", age: 20 }],
    [[2, 1, 1, 42, 1, 42]],
    user,
  ]);

  expect(view.pull()[0]).toEqual([
    { id: 0, name: "Bob", age: 17 },
    { id: 1, name: "Alice", age: 22 },
    { id: 2, name: "Eve", age: 20 },
  ]);

  expect(global).toEqual({ version: 2, peer: 42 });
});
