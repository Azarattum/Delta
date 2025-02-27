import { it, expect } from "bun:test";
import { shape } from "./shape";
import { copy, merge, type CLSet } from "./clset";

const user = shape((t) => ({
  id: t(t.INT, t.PRIMARY),
  name: t.STRING,
  age: t.INT,
}));
type User = (typeof user)["~type"];

it("merges partial structures", async () => {
  const a: CLSet<User> = [
    [
      { id: 0, name: "Alice", age: 17 },
      { id: 1, name: "Bob", age: 28 },
    ],
    [
      [1, 1, 1, 42, 1, 42],
      [1, 1, 1, 42, 1, 42],
    ],
    user,
  ];

  const b: CLSet<User> = [
    [
      { id: 0, name: "Conflict", age: 18 },
      undefined,
      { id: 2, name: "Carol", age: 42 },
    ],
    [[1, 1, 1, 41, 2, 41], undefined, [1, 1, 1, 41, 1, 41]],
  ];

  const merged = merge(a, b);
  expect(a).toBe(merged as typeof a);
  expect(a).toEqual([
    [
      { id: 0, name: "Alice", age: 18 },
      { id: 1, name: "Bob", age: 28 },
      { id: 2, name: "Carol", age: 42 },
    ],
    [
      [2, 1, 1, 42, 2, 41],
      [1, 1, 1, 42, 1, 42],
      [2, 1, 1, 41, 1, 41],
    ],
    user,
  ]);
});

it("bumps version for items", async () => {
  const added = merge(
    [[{ id: 0, name: "Alice", age: 17 }], [[1, 1, 1, 42, 1, 42]], user],
    [
      [undefined, { id: 0, name: "Bob", age: 11 }],
      [undefined, [1, 1, 1, 41, 1, 41]],
    ],
  );

  expect(added).toEqual([
    [
      { id: 0, name: "Alice", age: 17 },
      { id: 0, name: "Bob", age: 11 },
    ],
    [
      [1, 1, 1, 42, 1, 42],
      [2, 1, 1, 41, 1, 41],
    ],
    user,
  ]);

  const modified = merge(
    [[{ id: 0, name: "Alice", age: 17 }], [[1, 1, 1, 42, 1, 42]], user],
    [[{ id: 0, name: "Alice", age: 18 }], [[1, 1, 1, 42, 1, 43]]],
  );

  expect(modified).toEqual([
    [{ id: 0, name: "Alice", age: 18 }],
    [[2, 1, 1, 42, 1, 43]],
    user,
  ]);

  const unchanged = merge(
    [[{ id: 0, name: "Alice", age: 17 }], [[1, 1, 1, 42, 1, 42]], user],
    [[{ id: 0, name: "Alice", age: 18 }], [[1, 1, 1, 42, 1, 41]]],
  );

  expect(unchanged).toEqual([
    [{ id: 0, name: "Alice", age: 17 }],
    [[1, 1, 1, 42, 1, 42]],
    user,
  ]);
});

it("converges changes", async () => {
  const a = [[{ id: 0, name: "Alice", age: 18 }], [[2, 1, 1, 42, 2, 42]], user];
  const b = [[{ id: 0, name: "Alice", age: 19 }], [[2, 1, 1, 42, 2, 43]], user];
  const c = [[{ id: 0, name: "ALICE", age: 17 }], [[2, 1, 2, 41, 1, 41]], user];

  const nextB = merge(copy(b as any), c as any);
  const nextNextB = merge(copy(nextB), a as any);

  const nextA = merge(copy(a as any), b as any);
  const nextNextA = merge(copy(nextA), c as any);

  const nextC = merge(copy(c as any), a as any);
  const nextNextC = merge(copy(nextC) as any, b as any);

  // In this chain the version is lower due to conflict lose
  nextNextB[1][0]![0] += 1;

  expect(nextNextA).toEqual(nextNextB);
  expect(nextNextB).toEqual(nextNextC);
});

it("merges causal length", async () => {
  const merged = merge(
    [[{ id: 0, name: "Alice", age: 18 }], [[2, 1, 1, 42, 1, 42]], user],
    [[{ id: 0, name: "Don't care", age: 8 }], [[2, 2, 2, 44, 2, 45]], user],
  );

  expect(merged).toEqual([
    [{ id: 0, name: "Alice", age: 18 }],
    [[3, 2, 1, 42, 1, 42]],
    user,
  ]);
});

it("keeps incoming versions intact", async () => {
  const merged = merge(
    [
      [
        { id: 0, name: "Alice", age: 18 },
        { id: 1, name: "Bob", age: 14 },
        { id: 2, name: "Carol", age: 42 },
      ],
      [
        [1, 1, 1, 42, 1, 42],
        [1, 1, 1, 42, 1, 42],
        [1, 1, 1, 42, 1, 42],
      ],
      user,
    ],
    [
      [
        { id: 0, name: "Alice", age: 19 },
        { id: 1, name: "Bob", age: 20 },
        { id: 2, name: "Carol", age: 42 },
        { id: 3, name: "Kevin", age: 8 },
      ],
      [
        [2, 1, 1, 42, 2, 42],
        [3, 1, 1, 42, 2, 42],
        [2, 2, 1, 42, 1, 42],
        [2, 1, 1, 42, 1, 42],
      ],
      user,
    ],
  );

  expect(merged).toEqual([
    [
      { id: 0, name: "Alice", age: 19 },
      { id: 1, name: "Bob", age: 20 },
      { id: 2, name: "Carol", age: 42 },
      { id: 3, name: "Kevin", age: 8 },
    ],
    [
      [2, 1, 1, 42, 2, 42],
      [3, 1, 1, 42, 2, 42],
      [2, 2, 1, 42, 1, 42],
      [2, 1, 1, 42, 1, 42],
    ],
    user,
  ]);
});

it("deleted fields always loose resolution", async () => {
  const afterDelete = merge(
    [[{ id: 0, name: "Alice", age: 18 }], [[1, 2, 2, 42, 2, 42]], user],
    [[{ id: 0, name: "New Alice", age: 19 }], [[2, 3, 1, 42, 1, 42]], user],
  );

  expect(afterDelete).toEqual([
    [{ id: 0, name: "New Alice", age: 19 }],
    [[2, 3, 1, 42, 1, 42]],
    user,
  ]);

  const afterUpdate = merge(
    [[{ id: 0, name: "Alice", age: 18 }], [[1, 1, 2, 42, 2, 42]], user],
    [[{ id: 0, name: "New Alice", age: 19 }], [[2, 3, 1, 42, 1, 42]], user],
  );

  expect(afterUpdate).toEqual([
    [{ id: 0, name: "New Alice", age: 19 }],
    [[2, 3, 1, 42, 1, 42]],
    user,
  ]);
});

it("handles same clock but higher peer", async () => {
  const merged = merge(
    [[{ id: 0, name: "Alice", age: 20 }], [[1, 1, 5, 1, 4, 2]], user],
    [[{ id: 0, name: "Bob", age: 25 }], [[1, 1, 5, 2, 4, 3]], user],
  );

  expect(merged[0][0]).toEqual({ id: 0, name: "Bob", age: 25 });
  expect(merged[1][0]).toEqual([2, 1, 5, 2, 4, 3]);
});
