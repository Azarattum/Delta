import {
  add,
  copy,
  distinct,
  expand,
  multiply,
  previous,
  zero,
  type ZSet,
} from "./zset";
import { nest, shape } from "./shape";
import { expect, it } from "bun:test";
import { has, mark } from "./object";

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
  expect(zsetC[1].details).toEqual([[1], [1]]);
  expect(zsetC[1].details[0]).toBe(zsetC[1].details[1]);
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

it("multiplies through deep nesting with single match", () => {
  const relShape = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    rel: t(t.NULLABLE, t.INT),
  }));

  const zsetA: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 2, rel: 1 }],
    [3],
    relShape,
  ];
  const zsetB: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 1, rel: 0 }],
    [2],
    relShape,
  ];
  const zsetC: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 0, rel: null }],
    [1],
    relShape,
  ];

  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep");
    const result = multiply(copy(zsetA), "rel", tmp, "id", "deep");

    expect(result[0]).toEqual([
      {
        id: 2,
        rel: 1,
        deep: [{ id: 1, rel: 0, deep: [{ id: 0, rel: null }] }],
      },
    ]);
    expect(result[1]).toEqual([3] as any);
    expect(result[1].deep).toEqual([[2]] as any);
    expect(result[1].deep[0].deep).toEqual([[1]] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep", true);
    const result = multiply(copy(zsetA), "rel", tmp, "id", "deep");

    expect(result[0]).toEqual([
      { id: 2, rel: 1, deep: [{ id: 1, rel: 0, deep: { id: 0, rel: null } }] },
    ]);
    expect(result[1]).toEqual([3] as any);
    expect(result[1].deep).toEqual([[2]] as any);
    expect(result[1].deep[0]["deep"]).toEqual([1] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep");
    const result = multiply(copy(zsetA), "rel", tmp, "id", "deep", true);

    expect(result[0]).toEqual([
      { id: 2, rel: 1, deep: { id: 1, rel: 0, deep: [{ id: 0, rel: null }] } },
    ]);
    expect(result[1]).toEqual([3] as any);
    expect(result[1]["deep"]).toEqual([2] as any);
    expect(result[1]["deep"]["deep"]).toEqual([[1]] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep", true);
    const result = multiply(copy(zsetA), "rel", tmp, "id", "deep", true);

    expect(result[0]).toEqual([
      { id: 2, rel: 1, deep: { id: 1, rel: 0, deep: { id: 0, rel: null } } },
    ]);
    expect(result[1]).toEqual([3] as any);
    expect(result[1]["deep"]).toEqual([2] as any);
    expect(result[1]["deep"]["deep"]).toEqual([1] as any);
  }
});

it("multiplies through deep nesting with no matches", () => {
  const relShape = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    rel: t(t.NULLABLE, t.INT),
  }));

  const zsetA: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 2, rel: 1 }],
    [3],
    relShape,
  ];
  const zsetB: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 1, rel: 0 }],
    [2],
    relShape,
  ];
  const zsetC: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 0, rel: null }],
    [1],
    relShape,
  ];

  {
    const tmp = multiply(copy(zsetB), "id", zsetC, "id", "deep");
    const result = multiply(copy(zsetA), "id", tmp, "id", "deep");

    expect(result[0]).toEqual([{ id: 2, rel: 1, deep: [] }]);
    expect(result[1]).toEqual([3] as any);
    expect(result[1].deep).toEqual([[]] as any);
    expect(result[1].deep[0].deep).toEqual([] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "id", zsetC, "id", "deep", true);
    const result = multiply(copy(zsetA), "id", tmp, "id", "deep");

    expect(result[0]).toEqual([{ id: 2, rel: 1, deep: [] }]);
    expect(result[1]).toEqual([3] as any);
    expect(result[1].deep).toEqual([[]] as any);
    expect(result[1].deep[0]["deep"]).toEqual([] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "id", zsetC, "id", "deep");
    const result = multiply(copy(zsetA), "id", tmp, "id", "deep", true);

    expect(result[0]).toEqual([{ id: 2, rel: 1, deep: undefined }]);
    expect(result[1]).toEqual([3] as any);
    expect(result[1]["deep"]).toEqual([] as any);
    expect(result[1]["deep"]["deep"]).toEqual([] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "id", zsetC, "id", "deep", true);
    const result = multiply(copy(zsetA), "id", tmp, "id", "deep", true);

    expect(result[0]).toEqual([{ id: 2, rel: 1, deep: undefined }]);
    expect(result[1]).toEqual([3] as any);
    expect(result[1]["deep"]).toEqual([] as any);
    expect(result[1]["deep"]["deep"]).toEqual([] as any);
  }
});

it("multiplies through double deep nesting", () => {
  const relShape = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    rel: t(t.NULLABLE, t.INT),
  }));

  const zsetA: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 2, rel: 1 }],
    [3],
    relShape,
  ];
  const zsetB: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 1, rel: 0 }],
    [2],
    relShape,
  ];
  const zsetC: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 0, rel: null }],
    [1],
    relShape,
  ];
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep", true);
    const tmp2 = multiply(copy(zsetB), "id", tmp, "id", "deep", true);
    const result = multiply(copy(zsetA), "rel", tmp2, "id", "deep", true);

    expect(result[0]).toEqual([
      {
        id: 2,
        rel: 1,
        deep: {
          id: 1,
          rel: 0,
          deep: { id: 1, rel: 0, deep: { id: 0, rel: null } },
        },
      },
    ]);
    expect(result[1]).toEqual([3] as any);
    expect(result[1]["deep"]).toEqual([2] as any);
    expect(result[1]["deep"]["deep"]).toEqual([2] as any);
    expect(result[1]["deep"]["deep"]["deep"]).toEqual([1] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep3", true);
    const tmp2 = multiply(copy(zsetB), "id", tmp, "id", "deep2", true);
    const result = multiply(copy(zsetA), "rel", tmp2, "id", "deep1");

    expect(result[0]).toEqual([
      {
        id: 2,
        rel: 1,
        deep1: [
          {
            id: 1,
            rel: 0,
            deep2: { id: 1, rel: 0, deep3: { id: 0, rel: null } },
          },
        ],
      },
    ]);
    expect(result[1]).toEqual([3] as any);
    expect(result[1]["deep1"]).toEqual([[2]] as any);
    expect(result[1]["deep1"][0]["deep2"]).toEqual([2] as any);
    expect(result[1]["deep1"][0]["deep2"]["deep3"]).toEqual([1] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep3", true);
    const tmp2 = multiply(copy(zsetB), "id", tmp, "id", "deep2");
    const result = multiply(copy(zsetA), "rel", tmp2, "id", "deep1");

    expect(result[0]).toEqual([
      {
        id: 2,
        rel: 1,
        deep1: [
          {
            id: 1,
            rel: 0,
            deep2: [{ id: 1, rel: 0, deep3: { id: 0, rel: null } }],
          },
        ],
      },
    ]);
    expect(result[1]).toEqual([3] as any);
    expect(result[1]["deep1"]).toEqual([[2]] as any);
    expect(result[1]["deep1"][0]["deep2"]).toEqual([[2]] as any);
    expect(result[1]["deep1"][0]["deep2"][0]["deep3"]).toEqual([1] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep3");
    const tmp2 = multiply(copy(zsetB), "id", tmp, "id", "deep2");
    const result = multiply(copy(zsetA), "rel", tmp2, "id", "deep1");

    expect(result[0]).toEqual([
      {
        id: 2,
        rel: 1,
        deep1: [
          {
            id: 1,
            rel: 0,
            deep2: [{ id: 1, rel: 0, deep3: [{ id: 0, rel: null }] }],
          },
        ],
      },
    ]);
    expect(result[1]).toEqual([3] as any);
    expect(result[1]["deep1"]).toEqual([[2]] as any);
    expect(result[1]["deep1"][0]["deep2"]).toEqual([[2]] as any);
    expect(result[1]["deep1"][0]["deep2"][0]["deep3"]).toEqual([[1]] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep");
    const tmp2 = multiply(copy(zsetB), "id", tmp, "id", "deep", true);
    const result = multiply(copy(zsetA), "rel", tmp2, "id", "deep", true);

    expect(result[0]).toEqual([
      {
        id: 2,
        rel: 1,
        deep: {
          id: 1,
          rel: 0,
          deep: { id: 1, rel: 0, deep: [{ id: 0, rel: null }] },
        },
      },
    ]);
    expect(result[1]).toEqual([3] as any);
    expect(result[1]["deep"]).toEqual([2] as any);
    expect(result[1]["deep"]["deep"]).toEqual([2] as any);
    expect(result[1]["deep"]["deep"]["deep"]).toEqual([[1]] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep");
    const tmp2 = multiply(copy(zsetB), "id", tmp, "id", "deep");
    const result = multiply(copy(zsetA), "rel", tmp2, "id", "deep", true);

    expect(result[0]).toEqual([
      {
        id: 2,
        rel: 1,
        deep: {
          id: 1,
          rel: 0,
          deep: [{ id: 1, rel: 0, deep: [{ id: 0, rel: null }] }],
        },
      },
    ]);
    expect(result[1]).toEqual([3] as any);
    expect(result[1]["deep"]).toEqual([2] as any);
    expect(result[1]["deep"]["deep"]).toEqual([[2]] as any);
    expect(result[1]["deep"]["deep"][0]["deep"]).toEqual([[1]] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep");
    const tmp2 = multiply(copy(zsetB), "id", tmp, "id", "deep", true);
    const result = multiply(copy(zsetA), "rel", tmp2, "id", "deep");

    expect(result[0]).toEqual([
      {
        id: 2,
        rel: 1,
        deep: [
          {
            id: 1,
            rel: 0,
            deep: { id: 1, rel: 0, deep: [{ id: 0, rel: null }] },
          },
        ],
      },
    ]);
    expect(result[1]).toEqual([3] as any);
    expect(result[1]["deep"]).toEqual([[2]] as any);
    expect(result[1]["deep"][0]["deep"]).toEqual([2] as any);
    expect(result[1]["deep"][0]["deep"]["deep"]).toEqual([[1]] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep3", true);
    const tmp2 = multiply(copy(zsetB), "id", tmp, "id", "deep2");
    const result = multiply(copy(zsetA), "rel", tmp2, "id", "deep1", true);

    expect(result[0]).toEqual([
      {
        id: 2,
        rel: 1,
        deep1: {
          id: 1,
          rel: 0,
          deep2: [{ id: 1, rel: 0, deep3: { id: 0, rel: null } }],
        },
      },
    ]);
    expect(result[1]).toEqual([3] as any);
    expect(result[1]["deep1"]).toEqual([2] as any);
    expect(result[1]["deep1"]["deep2"]).toEqual([[2]] as any);
    expect(result[1]["deep1"]["deep2"][0]["deep3"]).toEqual([1] as any);
  }
});

it("multiplies through double deep nesting & multiple matches", () => {
  const relShape = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    rel: t(t.NULLABLE, t.INT),
  }));

  const zsetA: ZSet<(typeof relShape)["~type"]> = [
    [
      { id: 2, rel: 1 },
      { id: 3, rel: 1 },
    ],
    [3, 4],
    relShape,
  ];
  const zsetB: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 1, rel: 0 }],
    [2],
    relShape,
  ];
  const zsetC: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 0, rel: null }],
    [1],
    relShape,
  ];
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep3", true);
    const tmp2 = multiply(copy(zsetB), "id", tmp, "id", "deep2", true);
    const result = multiply(copy(zsetA), "rel", tmp2, "id", "deep1");

    expect(result[0]).toEqual([
      {
        id: 2,
        rel: 1,
        deep1: [
          {
            id: 1,
            rel: 0,
            deep2: { id: 1, rel: 0, deep3: { id: 0, rel: null } },
          },
        ],
      },
      {
        id: 3,
        rel: 1,
        deep1: [
          {
            id: 1,
            rel: 0,
            deep2: { id: 1, rel: 0, deep3: { id: 0, rel: null } },
          },
        ],
      },
    ]);
    expect(result[1]).toEqual([3, 4] as any);
    expect(result[1]["deep1"]).toEqual([[2], [2]] as any);
    expect(result[1]["deep1"][0]["deep2"]).toEqual([2] as any);
    expect(result[1]["deep1"][1]["deep2"]).toEqual([2] as any);
    expect(result[1]["deep1"][0]["deep2"]["deep3"]).toEqual([1] as any);
    expect(result[1]["deep1"][1]["deep2"]["deep3"]).toEqual([1] as any);

    expect(result[0][0].deep1).toBe(result[0][1].deep1);
    expect(result[1]["deep1"][0]).toBe(result[1]["deep1"][1]);
  }
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep3", true);
    const tmp2 = multiply(copy(zsetB), "id", tmp, "id", "deep2");
    const result = multiply(copy(zsetA), "rel", tmp2, "id", "deep1");

    expect(result[0]).toEqual([
      {
        id: 2,
        rel: 1,
        deep1: [
          {
            id: 1,
            rel: 0,
            deep2: [{ id: 1, rel: 0, deep3: { id: 0, rel: null } }],
          },
        ],
      },
      {
        id: 3,
        rel: 1,
        deep1: [
          {
            id: 1,
            rel: 0,
            deep2: [{ id: 1, rel: 0, deep3: { id: 0, rel: null } }],
          },
        ],
      },
    ]);
    expect(result[1]).toEqual([3, 4] as any);
    expect(result[1]["deep1"]).toEqual([[2], [2]] as any);
    expect(result[1]["deep1"][0]["deep2"]).toEqual([[2]] as any);
    expect(result[1]["deep1"][0]["deep2"][0]["deep3"]).toEqual([1] as any);
    expect(result[1]["deep1"][1]["deep2"]).toEqual([[2]] as any);
    expect(result[1]["deep1"][1]["deep2"][0]["deep3"]).toEqual([1] as any);

    expect(result[0][0].deep1).toBe(result[0][1].deep1);
    expect(result[1]["deep1"][0]).toBe(result[1]["deep1"][1]);
  }
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep3");
    const tmp2 = multiply(copy(zsetB), "id", tmp, "id", "deep2");
    const result = multiply(copy(zsetA), "rel", tmp2, "id", "deep1");

    expect(result[0]).toEqual([
      {
        id: 2,
        rel: 1,
        deep1: [
          {
            id: 1,
            rel: 0,
            deep2: [{ id: 1, rel: 0, deep3: [{ id: 0, rel: null }] }],
          },
        ],
      },
      {
        id: 3,
        rel: 1,
        deep1: [
          {
            id: 1,
            rel: 0,
            deep2: [{ id: 1, rel: 0, deep3: [{ id: 0, rel: null }] }],
          },
        ],
      },
    ]);
    expect(result[1]).toEqual([3, 4] as any);
    expect(result[1]["deep1"]).toEqual([[2], [2]] as any);
    expect(result[1]["deep1"][0]["deep2"]).toEqual([[2]] as any);
    expect(result[1]["deep1"][0]["deep2"][0]["deep3"]).toEqual([[1]] as any);
    expect(result[1]["deep1"][1]["deep2"]).toEqual([[2]] as any);
    expect(result[1]["deep1"][1]["deep2"][0]["deep3"]).toEqual([[1]] as any);

    expect(result[0][0].deep1).toBe(result[0][1].deep1);
    expect(result[1]["deep1"][0]).toBe(result[1]["deep1"][1]);
  }
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep3");
    const tmp2 = multiply(copy(zsetB), "id", tmp, "id", "deep2", true);
    const result = multiply(copy(zsetA), "rel", tmp2, "id", "deep1");

    expect(result[0]).toEqual([
      {
        id: 2,
        rel: 1,
        deep1: [
          {
            id: 1,
            rel: 0,
            deep2: { id: 1, rel: 0, deep3: [{ id: 0, rel: null }] },
          },
        ],
      },
      {
        id: 3,
        rel: 1,
        deep1: [
          {
            id: 1,
            rel: 0,
            deep2: { id: 1, rel: 0, deep3: [{ id: 0, rel: null }] },
          },
        ],
      },
    ]);
    expect(result[1]).toEqual([3, 4] as any);
    expect(result[1]["deep1"]).toEqual([[2], [2]] as any);
    expect(result[1]["deep1"][0]["deep2"]).toEqual([2] as any);
    expect(result[1]["deep1"][0]["deep2"]["deep3"]).toEqual([[1]] as any);
    expect(result[1]["deep1"][1]["deep2"]).toEqual([2] as any);
    expect(result[1]["deep1"][1]["deep2"]["deep3"]).toEqual([[1]] as any);

    expect(result[0][0].deep1).toBe(result[0][1].deep1);
    expect(result[1]["deep1"][0]).toBe(result[1]["deep1"][1]);
  }
});

it("tracks previous values through multiple updates", () => {
  const idShape = shape((t) => ({ id: t(t.INT, t.PRIMARY), v: t.INT }));
  const v1 = { id: 1, v: 1 };
  const v2 = { id: 1, v: 2 };
  const v3 = { id: 1, v: 3 };

  const a: ZSet<(typeof idShape)["~type"]> = [[v1], [1], idShape];
  const b: ZSet<(typeof idShape)["~type"]> = [[v2], [-1], idShape];

  add(a, b);
  expect(a[1][0]).toBe(0);
  expect(a[0][0]).toBe(v2);

  expect((a[0][0] as any)[previous]).toBe(v1);

  const c: ZSet<(typeof idShape)["~type"]> = [[v3], [-1], idShape];
  add(a, c);
  expect(a[1][0]).toBe(-1);
  expect(a[0][0]).toBe(v3);

  expect((a[0][0] as any)[previous]).toBe(v1);
});

it("add condition is minimal for zero detection", () => {
  const idShape = shape((t) => ({ id: t(t.INT, t.PRIMARY), v: t.INT }));

  const cases: Array<[number, number, boolean, string]> = [
    [1, -1, true, "1 + -1 = 0, should mark"],
    [-1, 1, true, "-1 + 1 = 0, should mark"],
    [2, -2, true, "2 + -2 = 0, should mark"],
    [0, 0, false, "0 + 0 = 0, should NOT mark"],
    [1, 1, false, "1 + 1 = 2, should NOT mark"],
    [1, 0, false, "1 + 0 = 1, should NOT mark"],
    [0, 1, false, "0 + 1 = 1, should NOT mark"],
    [-1, -1, false, "-1 + -1 = -2, should NOT mark"],
  ];

  for (const [aMeta, bMeta, shouldMark, desc] of cases) {
    const a: ZSet<(typeof idShape)["~type"]> = [
      [{ id: 1, v: 1 }],
      [aMeta],
      idShape,
    ];
    const b: ZSet<(typeof idShape)["~type"]> = [
      [{ id: 1, v: 2 }],
      [bMeta],
      idShape,
    ];

    add(a, b);
    expect(has(a[0][0], previous), desc).toBe(shouldMark);
    expect(a[1][0]).toBe(aMeta + bMeta);
  }
});

it("expand correctly copies nested metadata", () => {
  const msg = shape((t) => ({ id: t(t.INT, t.PRIMARY), uid: t.INT }));
  const detail = shape((t) => ({ id: t(t.INT, t.PRIMARY) }));

  const oldMsg = { id: 1, uid: 1 };
  const newMsg = mark({ id: 1, uid: 2 }, previous, oldMsg);

  const messages: ZSet<(typeof msg)["~type"]> = [[newMsg], [0], msg];
  const details: ZSet<(typeof detail)["~type"]> = [
    [{ id: 1 }, { id: 2 }],
    [1, 1],
    detail,
  ];

  multiply(details, "id", copy(details), "id", "details2", true);
  multiply(messages, "uid", details, "id", "details", true);

  expand(messages, "uid");

  expect(messages[0].length).toBe(2);
  expect(messages[1].length).toBe(2);

  expect(messages[0][0]).toBe(oldMsg);
  expect(messages[1][0]).toBe(-1);
  expect(messages[0][1]).toBe(newMsg);
  expect(messages[1][1]).toBe(1);

  expect(messages[1]["details"].length).toBe(2);
  expect(messages[1]["details"]["details2"].length).toBe(2);
  expect(has(messages[1]["details"], 0)).toBe(false);
  expect(has(messages[1]["details"]["details2"], 0)).toBe(false);

  expect(has(messages[0][0], previous)).toBe(false);
  expect(has(messages[0][1], previous)).toBe(false);
});

it("expand handles same key value correctly", () => {
  const idShape = shape((t) => ({ id: t(t.INT, t.PRIMARY), v: t.INT }));

  const oldItem = { id: 1, v: 5 };
  const newItem = mark({ id: 1, v: 5 }, previous, oldItem);

  const item: ZSet<(typeof idShape)["~type"]> = [[newItem], [0], idShape];

  const before = item[0].length;
  expand(item, "v");
  expect(item[0].length).toBe(before);
});
