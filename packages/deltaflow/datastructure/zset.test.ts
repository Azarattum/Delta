import { add, copy, distinct, multiply, zero, type ZSet } from "./zset";
import { nest, shape } from "./shape";
import { expect, it } from "bun:test";

it("performs one-to-one multiplication", () => {
  const a = shape((t) => ({ id: t(t.INT, t.PRIMARY), name: t.STRING }));
  const b = shape((t) => ({ id: t(t.INT, t.PRIMARY), age: t.INT }));

  const zsetA: ZSet<(typeof a)["~type"]> = [
    [
      { id: 1, name: "John" },
      { id: 2, name: "Jane" },
    ],
    [1, 1],
    a,
  ];

  const zsetB: ZSet<(typeof b)["~type"]> = [
    [
      { id: 1, age: 25 },
      { id: 2, age: 30 },
    ],
    [1, 1],
    b,
  ];

  const zsetC = multiply(copy(zsetA), "id", zsetB, "id", "details");
  expect(zsetC[0]).toEqual([
    { id: 1, name: "John", details: [{ id: 1, age: 25 }] },
    { id: 2, name: "Jane", details: [{ id: 2, age: 30 }] },
  ]);
  expect({ ...zsetC[1] }).toEqual({ 0: 1, 1: 1, details: [[1], [1]] } as any);
  expect(zsetC[2]).toEqual(nest(a, "details", b));

  const zsetD = multiply(zsetA, "id", zsetB, "id", "details", true);
  expect(zsetD[0]).toEqual([
    { id: 1, name: "John", details: { id: 1, age: 25 } },
    { id: 2, name: "Jane", details: { id: 2, age: 30 } },
  ]);
  expect({ ...zsetD[1] }).toEqual({ 0: 1, 1: 1, details: [1, 1] } as any);
  expect(zsetD[2]).toEqual(nest(a, "details", b, true));
});

it("performs grouped multiplication", () => {
  const a = shape((t) => ({ id: t(t.INT, t.PRIMARY), name: t.STRING }));
  const b = shape((t) => ({ id: t(t.INT, t.PRIMARY), age: t.INT }));
  const both = nest(a, "details", b);

  const zsetA: ZSet<(typeof a)["~type"]> = [
    [
      { id: 1, name: "John" },
      { id: 2, name: "Jane" },
    ],
    [1, 1],
    a,
  ];

  const zsetB: ZSet<(typeof b)["~type"]> = [
    [
      { id: 1, age: 25 },
      { id: 1, age: 30 },
      { id: 2, age: 35 },
    ],
    [1, 1],
    b,
  ];

  expect(multiply(zsetA, "id", zsetB, "id", "details")).toEqual([
    [
      {
        id: 1,
        name: "John",
        details: [
          { id: 1, age: 25 },
          { id: 1, age: 30 },
        ],
      },
      { id: 2, name: "Jane", details: [{ id: 2, age: 35 }] },
    ],
    Object.assign([1, 1], { details: [[1], [1]] }),
    both,
  ]);
});

it("performs distributed multiplication", () => {
  const a = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
    detailsID: t.INT,
  }));
  const b = shape((t) => ({ id: t(t.INT, t.PRIMARY), age: t.INT }));
  const both = nest(a, "details", b);

  const zsetA: ZSet<(typeof a)["~type"]> = [
    [
      { id: 1, name: "John", detailsID: 1 },
      { id: 2, name: "Jane", detailsID: 1 },
    ],
    [1, 1],
    a,
  ];

  const zsetB: ZSet<(typeof b)["~type"]> = [[{ id: 1, age: 25 }], [1, 1], b];

  const zsetC = multiply(zsetA, "detailsID", zsetB, "id", "details");
  expect(zsetC).toEqual([
    [
      { id: 1, name: "John", detailsID: 1, details: [{ id: 1, age: 25 }] },
      { id: 2, name: "Jane", detailsID: 1, details: [{ id: 1, age: 25 }] },
    ],
    Object.assign([1, 1], { details: [[1], [1]] }),
    both,
  ]);
  expect(zsetC[0][0].details).toBe(zsetC[0][1].details);
});

it("performs out of order multiplication", () => {
  const a = shape((t) => ({ id: t(t.INT, t.PRIMARY), name: t.STRING }));
  const b = shape((t) => ({ id: t(t.INT, t.PRIMARY), age: t.INT }));
  const both = nest(a, "details", b);

  const zsetA: ZSet<(typeof a)["~type"]> = [
    [
      { id: 1, name: "John" },
      { id: 2, name: "Jane" },
    ],
    [1, 1],
    a,
  ];

  const zsetB: ZSet<(typeof b)["~type"]> = [
    [
      { id: 2, age: 30 },
      { id: 1, age: 25 },
    ],
    [1, 1],
    b,
  ];

  expect(multiply(zsetA, "id", zsetB, "id", "details")).toEqual([
    [
      { id: 1, name: "John", details: [{ id: 1, age: 25 }] },
      { id: 2, name: "Jane", details: [{ id: 2, age: 30 }] },
    ],
    Object.assign([1, 1], { details: [[1], [1]] }),
    both,
  ]);
});

it("avoids double counting with shared references", () => {
  const shared = { id: 1 };
  const base: ZSet<{ id: number }> = [[shared], [1]];
  const added = add(base, base);
  expect(added[1]).toEqual([1]);
  expect(added[0].length).toBe(1);
});

it("properly adds primitive values", () => {
  const base: ZSet<number> = [[1], [1]];
  const added = add(base, base);
  expect(added[1]).toEqual([2]);
  expect(added[0].length).toBe(1);
});

it("zeroes & copies multiple items correctly", () => {
  const a = shape((t) => ({ id: t(t.INT, t.PRIMARY) }));
  const b = shape((t) => ({ age: t(t.INT, t.PRIMARY) }));
  const both = nest(a, "details", b);

  const zsetA: ZSet<{ id: number; details: { age: number }[] }> = [
    [
      { id: 1, details: [{ age: 25 }] },
      { id: 2, details: [{ age: 30 }] },
    ],
    Object.assign([1, 1], { details: [[2], [1]] }),
    both,
  ];

  const zsetB = copy(zsetA);
  zero(zsetA);

  expect(zsetA[1]).toEqual([0, 0] as any);
  expect(zsetA[1].details).toEqual([[0], [0]]);
  expect(zsetB[1]).toEqual([1, 1] as any);
  expect(zsetB[1].details).toEqual([[2], [1]]);

  const zsetC = copy(zsetB);
  distinct(zsetC);

  expect(zsetC[1]).toEqual([1, 1] as any);
  expect(zsetC[1].details).toEqual([[1], [1]]);
});

it("zeroes & copies single items correctly", () => {
  const a = shape((t) => ({ id: t(t.INT, t.PRIMARY) }));
  const b = shape((t) => ({ age: t(t.INT, t.PRIMARY) }));
  const both = nest(a, "details", b, true);

  const zsetA: ZSet<(typeof both)["~type"]> = [
    [
      { id: 1, details: { age: 25 } },
      { id: 2, details: { age: 30 } },
    ],
    Object.assign([1, 0], { details: [2, 1] }),
    both,
  ];

  const zsetB = copy(zsetA);
  zero(zsetA);

  expect(zsetA[1]).toEqual([0, 0] as any);
  expect(zsetA[1].details).toEqual([0, 0]);
  expect(zsetB[1]).toEqual([1, 0] as any);
  expect(zsetB[1].details).toEqual([2, 1]);

  const zsetC = copy(zsetB);
  distinct(zsetC);

  expect(zsetC[1]).toEqual([1] as any);
  expect(zsetC[1].details).toEqual([1]);
});

it("adds with one-to-one relationships", () => {
  const a = shape((t) => ({ id: t(t.INT, t.PRIMARY) }));
  const b = shape((t) => ({ age: t(t.INT, t.PRIMARY) }));
  const both = nest(a, "details", b, true);

  const zsetA: ZSet<{ id: number; details?: { age: number } }> = [
    [{ id: 1, details: { age: 25 } }],
    Object.assign([1], { details: [1] }),
    both,
  ];

  const zsetB: ZSet<{ id: number; details?: { age: number } }> = [
    [{ id: 1, details: { age: 42 } }],
    Object.assign([1], { details: [0] }),
    both,
  ];

  add(zsetA, zsetB);

  expect(zsetA[0]).toEqual([{ id: 1, details: { age: 42 } }]);
  expect({ ...zsetA[1] }).toEqual({ 0: 2, details: [1] } as any);

  add(zsetB, zsetA);

  expect(zsetB[0]).toEqual([{ id: 1, details: { age: 42 } }]);
  expect({ ...zsetB[1] }).toEqual({ 0: 3, details: [1] } as any);
});

it("applies distinct on deep items", () => {
  const a = shape((t) => ({ id: t(t.INT, t.PRIMARY) }));
  const b = shape((t) => ({ age: t(t.INT, t.PRIMARY) }));
  const both = nest(a, "details", nest(b, "details", b, true), true);

  const zsetA: ZSet<(typeof both)["~type"]> = [
    [
      { id: 1, details: { age: 25, details: { age: 17 } } },
      { id: 2, details: { age: 30, details: { age: 42 } } },
    ],
    Object.assign([2, 0], {
      details: Object.assign([2, 2], { details: [2, 2] }),
    }),
    both,
  ];

  distinct(zsetA);

  expect(zsetA[1]).toEqual([1] as any);
  expect(zsetA[1].details).toEqual([1] as any);
  expect(zsetA[1].details.details).toEqual([1] as any);
});
