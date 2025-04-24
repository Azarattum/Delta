import { multiply, type ZSet } from "./zset";
import { nest, shape } from "./shape";
import { expect, it } from "bun:test";

it("performs one-to-one multiplication", () => {
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
      { id: 2, age: 30 },
    ],
    [1, 1],
    b,
  ];

  expect(multiply(zsetA, "id", zsetB, "id", "details")).toEqual([
    [
      { id: 1, name: "John", details: [{ id: 1, age: 25 }] },
      { id: 2, name: "Jane", details: [{ id: 2, age: 30 }] },
    ],
    [1, 1],
    both,
  ]);
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
    [1, 1],
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
    [1, 1],
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
    [1, 1],
    both,
  ]);
});
