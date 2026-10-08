import {
  cardinality,
  materialize,
  integrate,
  distinct,
  multiply,
  changed,
  combine,
  create,
  remove,
  update,
  copy,
  zero,
  add,
  cut,
} from "./zset";
import { nest, shape, reorder, compare } from "./shape";
import type { Meta } from "./metaset.types";
import { expect, it } from "bun:test";
import type { Shape } from "./shape";
import type { ZSet } from "./zset";

it("performs one-to-one multiplication", () => {
  const a = shape((t) => ({ id: t(t.INT, t.PRIMARY), name: t.STRING }));
  const b = shape((t) => ({ id: t(t.INT, t.PRIMARY), age: t.INT }));

  const zsetA: ZSet<(typeof a)["~type"]> = [
    [
      { id: 1, name: "John" },
      { id: 2, name: "Jane" },
    ],
    [create(a), create(a)],
    a,
  ];

  const zsetB: ZSet<(typeof b)["~type"]> = [
    [
      { id: 1, age: 25 },
      { id: 2, age: 30 },
    ],
    [create(b), create(b)],
    b,
  ];

  const zsetC = multiply(copy(zsetA), "id", zsetB, "id", "details");
  expect(zsetC[0]).toEqual([
    { id: 1, name: "John", details: [{ id: 1, age: 25 }] },
    { id: 2, name: "Jane", details: [{ id: 2, age: 30 }] },
  ]);
  expect({ ...zsetC[1] }).toEqual({
    0: create(nest(a, "details", b)),
    1: create(nest(a, "details", b)),
    details: [[create(b)], [create(b)]],
  } as any);
  expect(zsetC[2]).toEqual(nest(a, "details", b));

  const zsetD = multiply(zsetA, "id", zsetB, "id", "details", true);
  expect(zsetD[0]).toEqual([
    { id: 1, name: "John", details: { id: 1, age: 25 } },
    { id: 2, name: "Jane", details: { id: 2, age: 30 } },
  ]);
  expect({ ...zsetD[1] }).toEqual({
    0: create(nest(a, "details", b, true)),
    1: create(nest(a, "details", b, true)),
    details: [create(b), create(b)],
  } as any);
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
    [create(a), create(a)],
    a,
  ];

  const zsetB: ZSet<(typeof b)["~type"]> = [
    [
      { id: 1, age: 25 },
      { id: 1, age: 30 },
      { id: 2, age: 35 },
    ],
    [create(b), create(b), create(b)],
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
    Object.assign([create(both), create(both)], {
      details: [[create(b), create(b)], [create(b)]],
    }),
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
    [create(a), create(a)],
    a,
  ];

  const zsetB: ZSet<(typeof b)["~type"]> = [
    [{ id: 1, age: 25 }],
    [create(b)],
    b,
  ];

  const zsetC = multiply(zsetA, "detailsID", zsetB, "id", "details");
  expect(zsetC).toEqual([
    [
      { id: 1, name: "John", detailsID: 1, details: [{ id: 1, age: 25 }] },
      { id: 2, name: "Jane", detailsID: 1, details: [{ id: 1, age: 25 }] },
    ],
    Object.assign([create(both), create(both)], {
      details: [[create(b)], [create(b)]],
    }),
    both,
  ]);
  expect(zsetC[0][0].details).toBe(zsetC[0][1].details);
  expect(zsetC[1].details).toEqual([[create(b)], [create(b)]]);
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
    [create(a), create(a)],
    a,
  ];

  const zsetB: ZSet<(typeof b)["~type"]> = [
    [
      { id: 2, age: 30 },
      { id: 1, age: 25 },
    ],
    [create(b), create(b)],
    b,
  ];

  expect(multiply(zsetA, "id", zsetB, "id", "details")).toEqual([
    [
      { id: 1, name: "John", details: [{ id: 1, age: 25 }] },
      { id: 2, name: "Jane", details: [{ id: 2, age: 30 }] },
    ],
    Object.assign([create(both), create(both)], {
      details: [[create(b)], [create(b)]],
    }),
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
    Object.assign([create(both), create(both)], {
      details: [[create(b, 2)], [create(b)]],
    }),
    both,
  ];

  const zsetB = copy(zsetA);
  zero(zsetA);

  expect(zsetA[1]).toEqual([update(both), update(both)] as any);
  expect(zsetA[1].details).toEqual([[update(b)], [update(b)]]);
  expect(zsetB[1]).toEqual([create(both), create(both)] as any);
  expect(zsetB[1].details).toEqual([[create(b, 2)], [create(b)]]);

  const zsetC = copy(zsetB);
  distinct(zsetC);

  expect(zsetC[1]).toEqual([create(both), create(both)] as any);
  expect(zsetC[1].details).toEqual([[create(b)], [create(b)]]);
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
    Object.assign([create(both), update(both)], {
      details: [create(b, 2), create(b)],
    }),
    both,
  ];

  const zsetB = copy(zsetA);
  zero(zsetA);

  expect(zsetA[1]).toEqual([update(both), update(both)] as any);
  expect(zsetA[1].details).toEqual([update(b), update(b)]);
  expect(zsetB[1]).toEqual([create(both), update(both)] as any);
  expect(zsetB[1].details).toEqual([create(b, 2), create(b)]);

  const zsetC = copy(zsetB);
  distinct(zsetC);

  expect(zsetC[1]).toEqual([create(both)] as any);
  expect(zsetC[1].details).toEqual([create(b)]);
});

it("adds with one-to-one relationships", () => {
  const a = shape((t) => ({ id: t(t.INT, t.PRIMARY) }));
  const b = shape((t) => ({ age: t(t.INT, t.PRIMARY) }));
  const both = nest(a, "details", b, true);

  const zsetA: ZSet<{ id: number; details?: { age: number } }> = [
    [{ id: 1, details: { age: 25 } }],
    Object.assign([create(both)], { details: [create(b)] }),
    both,
  ];

  const zsetB: ZSet<{ id: number; details?: { age: number } }> = [
    [{ id: 1, details: { age: 42 } }],
    Object.assign([create(both)], { details: [create(b)] }),
    both,
  ];

  add(zsetA, zsetB);

  expect(zsetA[0]).toEqual([{ id: 1, details: { age: 42 } }]);
  expect({ ...zsetA[1] }).toEqual({
    0: create(both, 2),
    details: [create(b, 2)],
  } as any);

  add(zsetB, zsetA);

  expect(zsetB[0]).toEqual([{ id: 1, details: { age: 42 } }]);
  expect({ ...zsetB[1] }).toEqual({
    0: create(both, 3),
    details: [create(b, 3)],
  } as any);
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
    Object.assign([create(both, 2), update(both)], {
      details: Object.assign([create(b, 2), create(b, 2)], {
        details: [create(b, 2), create(b, 2)],
      }),
    }),
    both,
  ];

  distinct(zsetA);

  expect(zsetA[1]).toEqual([create(both)] as any);
  expect(zsetA[1].details).toEqual([create(b)] as any);
  expect(zsetA[1].details.details).toEqual([create(b)] as any);
});

it("multiplies through deep nesting with single match", () => {
  const relShape = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    rel: t(t.NULLABLE, t.INT),
  }));

  const zsetA: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 2, rel: 1 }],
    [create(relShape, 2)],
    relShape,
  ];
  const zsetB: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 1, rel: 0 }],
    [create(relShape)],
    relShape,
  ];
  const zsetC: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 0, rel: null }],
    [update(relShape)],
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
    expect(result[1]).toEqual([create(relShape, 2)] as any);
    expect(result[1].deep).toEqual([[create(relShape)]] as any);
    expect(result[1].deep[0].deep).toEqual([[update(relShape)]] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep", true);
    const result = multiply(copy(zsetA), "rel", tmp, "id", "deep");

    expect(result[0]).toEqual([
      { id: 2, rel: 1, deep: [{ id: 1, rel: 0, deep: { id: 0, rel: null } }] },
    ]);
    expect(result[1]).toEqual([create(relShape, 2)] as any);
    expect(result[1].deep).toEqual([[create(relShape)]] as any);
    expect(result[1].deep[0]["deep"]).toEqual([update(relShape)] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep");
    const result = multiply(copy(zsetA), "rel", tmp, "id", "deep", true);

    expect(result[0]).toEqual([
      { id: 2, rel: 1, deep: { id: 1, rel: 0, deep: [{ id: 0, rel: null }] } },
    ]);
    expect(result[1]).toEqual([create(relShape, 2)] as any);
    expect(result[1]["deep"]).toEqual([create(relShape)] as any);
    expect(result[1]["deep"]["deep"]).toEqual([[update(relShape)]] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "rel", zsetC, "id", "deep", true);
    const result = multiply(copy(zsetA), "rel", tmp, "id", "deep", true);

    expect(result[0]).toEqual([
      { id: 2, rel: 1, deep: { id: 1, rel: 0, deep: { id: 0, rel: null } } },
    ]);
    expect(result[1]).toEqual([create(relShape, 2)] as any);
    expect(result[1]["deep"]).toEqual([create(relShape)] as any);
    expect(result[1]["deep"]["deep"]).toEqual([update(relShape)] as any);
  }
});

it("multiplies through deep nesting with no matches", () => {
  const relShape = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    rel: t(t.NULLABLE, t.INT),
  }));

  const zsetA: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 2, rel: 1 }],
    [create(relShape, 2)],
    relShape,
  ];
  const zsetB: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 1, rel: 0 }],
    [create(relShape)],
    relShape,
  ];
  const zsetC: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 0, rel: null }],
    [update(relShape)],
    relShape,
  ];

  {
    const tmp = multiply(copy(zsetB), "id", zsetC, "id", "deep");
    const result = multiply(copy(zsetA), "id", tmp, "id", "deep");

    expect(result[0]).toEqual([{ id: 2, rel: 1, deep: [] }]);
    expect(result[1]).toEqual([create(relShape, 2)] as any);
    expect(result[1].deep).toEqual([[]] as any);
    expect(result[1].deep[0].deep).toEqual([] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "id", zsetC, "id", "deep", true);
    const result = multiply(copy(zsetA), "id", tmp, "id", "deep");

    expect(result[0]).toEqual([{ id: 2, rel: 1, deep: [] }]);
    expect(result[1]).toEqual([create(relShape, 2)] as any);
    expect(result[1].deep).toEqual([[]] as any);
    expect(result[1].deep[0]["deep"]).toEqual([] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "id", zsetC, "id", "deep");
    const result = multiply(copy(zsetA), "id", tmp, "id", "deep", true);

    expect(result[0]).toEqual([{ id: 2, rel: 1, deep: undefined }]);
    expect(result[1]).toEqual([create(relShape, 2)] as any);
    expect(result[1]["deep"]).toEqual([] as any);
    expect(result[1]["deep"]["deep"]).toEqual([] as any);
  }
  {
    const tmp = multiply(copy(zsetB), "id", zsetC, "id", "deep", true);
    const result = multiply(copy(zsetA), "id", tmp, "id", "deep", true);

    expect(result[0]).toEqual([{ id: 2, rel: 1, deep: undefined }]);
    expect(result[1]).toEqual([create(relShape, 2)] as any);
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
    [create(relShape, 2)],
    relShape,
  ];
  const zsetB: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 1, rel: 0 }],
    [create(relShape)],
    relShape,
  ];
  const zsetC: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 0, rel: null }],
    [update(relShape)],
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
    expect(result[1]).toEqual([create(relShape, 2)] as any);
    expect(result[1]["deep"]).toEqual([create(relShape)] as any);
    expect(result[1]["deep"]["deep"]).toEqual([create(relShape)] as any);
    expect(result[1]["deep"]["deep"]["deep"]).toEqual([
      update(relShape),
    ] as any);
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
    expect(result[1]).toEqual([create(relShape, 2)] as any);
    expect(result[1]["deep1"]).toEqual([[create(relShape)]] as any);
    expect(result[1]["deep1"][0]["deep2"]).toEqual([create(relShape)] as any);
    expect(result[1]["deep1"][0]["deep2"]["deep3"]).toEqual([
      update(relShape),
    ] as any);
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
    expect(result[1]).toEqual([create(relShape, 2)] as any);
    expect(result[1]["deep1"]).toEqual([[create(relShape)]] as any);
    expect(result[1]["deep1"][0]["deep2"]).toEqual([[create(relShape)]] as any);
    expect(result[1]["deep1"][0]["deep2"][0]["deep3"]).toEqual([
      update(relShape),
    ] as any);
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
    expect(result[1]).toEqual([create(relShape, 2)] as any);
    expect(result[1]["deep1"]).toEqual([[create(relShape)]] as any);
    expect(result[1]["deep1"][0]["deep2"]).toEqual([[create(relShape)]] as any);
    expect(result[1]["deep1"][0]["deep2"][0]["deep3"]).toEqual([
      [update(relShape)],
    ] as any);
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
    expect(result[1]).toEqual([create(relShape, 2)] as any);
    expect(result[1]["deep"]).toEqual([create(relShape)] as any);
    expect(result[1]["deep"]["deep"]).toEqual([create(relShape)] as any);
    expect(result[1]["deep"]["deep"]["deep"]).toEqual([
      [update(relShape)],
    ] as any);
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
    expect(result[1]).toEqual([create(relShape, 2)] as any);
    expect(result[1]["deep"]).toEqual([create(relShape)] as any);
    expect(result[1]["deep"]["deep"]).toEqual([[create(relShape)]] as any);
    expect(result[1]["deep"]["deep"][0]["deep"]).toEqual([
      [update(relShape)],
    ] as any);
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
    expect(result[1]).toEqual([create(relShape, 2)] as any);
    expect(result[1]["deep"]).toEqual([[create(relShape)]] as any);
    expect(result[1]["deep"][0]["deep"]).toEqual([create(relShape)] as any);
    expect(result[1]["deep"][0]["deep"]["deep"]).toEqual([
      [update(relShape)],
    ] as any);
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
    expect(result[1]).toEqual([create(relShape, 2)] as any);
    expect(result[1]["deep1"]).toEqual([create(relShape)] as any);
    expect(result[1]["deep1"]["deep2"]).toEqual([[create(relShape)]] as any);
    expect(result[1]["deep1"]["deep2"][0]["deep3"]).toEqual([
      update(relShape),
    ] as any);
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
    [create(relShape, 2), create(relShape, 3)],
    relShape,
  ];
  const zsetB: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 1, rel: 0 }],
    [create(relShape)],
    relShape,
  ];
  const zsetC: ZSet<(typeof relShape)["~type"]> = [
    [{ id: 0, rel: null }],
    [update(relShape)],
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
    expect(result[1]).toEqual([
      create(relShape, 2),
      create(relShape, 3),
    ] as any);
    expect(result[1]["deep1"]).toEqual([
      [create(relShape)],
      [create(relShape)],
    ] as any);
    expect(result[1]["deep1"][0]["deep2"]).toEqual([create(relShape)] as any);
    expect(result[1]["deep1"][1]["deep2"]).toEqual([create(relShape)] as any);
    expect(result[1]["deep1"][0]["deep2"]["deep3"]).toEqual([
      update(relShape),
    ] as any);
    expect(result[1]["deep1"][1]["deep2"]["deep3"]).toEqual([
      update(relShape),
    ] as any);

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
    expect(result[1]).toEqual([
      create(relShape, 2),
      create(relShape, 3),
    ] as any);
    expect(result[1]["deep1"]).toEqual([
      [create(relShape)],
      [create(relShape)],
    ] as any);
    expect(result[1]["deep1"][0]["deep2"]).toEqual([[create(relShape)]] as any);
    expect(result[1]["deep1"][0]["deep2"][0]["deep3"]).toEqual([
      update(relShape),
    ] as any);
    expect(result[1]["deep1"][1]["deep2"]).toEqual([[create(relShape)]] as any);
    expect(result[1]["deep1"][1]["deep2"][0]["deep3"]).toEqual([
      update(relShape),
    ] as any);

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
    expect(result[1]).toEqual([
      create(relShape, 2),
      create(relShape, 3),
    ] as any);
    expect(result[1]["deep1"]).toEqual([
      [create(relShape)],
      [create(relShape)],
    ] as any);
    expect(result[1]["deep1"][0]["deep2"]).toEqual([[create(relShape)]] as any);
    expect(result[1]["deep1"][0]["deep2"][0]["deep3"]).toEqual([
      [update(relShape)],
    ] as any);
    expect(result[1]["deep1"][1]["deep2"]).toEqual([[create(relShape)]] as any);
    expect(result[1]["deep1"][1]["deep2"][0]["deep3"]).toEqual([
      [update(relShape)],
    ] as any);

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
    expect(result[1]).toEqual([
      create(relShape, 2),
      create(relShape, 3),
    ] as any);
    expect(result[1]["deep1"]).toEqual([
      [create(relShape)],
      [create(relShape)],
    ] as any);
    expect(result[1]["deep1"][0]["deep2"]).toEqual([create(relShape)] as any);
    expect(result[1]["deep1"][0]["deep2"]["deep3"]).toEqual([
      [update(relShape)],
    ] as any);
    expect(result[1]["deep1"][1]["deep2"]).toEqual([create(relShape)] as any);
    expect(result[1]["deep1"][1]["deep2"]["deep3"]).toEqual([
      [update(relShape)],
    ] as any);

    expect(result[0][0].deep1).toBe(result[0][1].deep1);
    expect(result[1]["deep1"][0]).toBe(result[1]["deep1"][1]);
  }
});

it("cuts sets correctly", () => {
  const idShape = shape((t) => ({ id: t(t.INT, t.PRIMARY) }));
  const nested = nest(nest(idShape, "single", idShape, true), "multi", idShape);
  const zset: ZSet<(typeof nested)["~type"]> = [
    [
      { id: 1, single: { id: 1 }, multi: [{ id: 1 }] },
      { id: 2, single: { id: 2 }, multi: [{ id: 2 }] },
      { id: 3, single: { id: 3 }, multi: [{ id: 3 }] },
      { id: 4, single: { id: 4 }, multi: [{ id: 4 }] },
      { id: 5, single: { id: 5 }, multi: [{ id: 5 }] },
    ],
    Object.assign(Array(5).fill(create(nested)), {
      multi: Array(5).fill([create(idShape)]),
      single: Array(5).fill(create(idShape)),
    }),
    nested,
  ];

  {
    const [zsetA, zsetB] = cut(copy(zset), 2);

    expect(zsetA[0]).toEqual([
      { id: 1, single: { id: 1 }, multi: [{ id: 1 }] },
      { id: 2, single: { id: 2 }, multi: [{ id: 2 }] },
    ]);
    expect(zsetA[1] as any).toEqual([create(nested), create(nested)]);
    expect(zsetA[1].multi).toEqual([[create(idShape)], [create(idShape)]]);
    expect(zsetA[1].single).toEqual([create(idShape), create(idShape)]);

    expect(zsetB[0]).toEqual([
      { id: 3, single: { id: 3 }, multi: [{ id: 3 }] },
      { id: 4, single: { id: 4 }, multi: [{ id: 4 }] },
      { id: 5, single: { id: 5 }, multi: [{ id: 5 }] },
    ]);
    expect(zsetB[1] as any).toEqual([
      create(nested),
      create(nested),
      create(nested),
    ]);
    expect(zsetB[1].single).toEqual([
      create(idShape),
      create(idShape),
      create(idShape),
    ]);
    expect(zsetB[1].multi).toEqual([
      [create(idShape)],
      [create(idShape)],
      [create(idShape)],
    ]);
  }

  {
    const [zsetA, zsetB, zsetC] = cut(zset, 2, 4);

    expect(zsetA[0]).toEqual([
      { id: 1, single: { id: 1 }, multi: [{ id: 1 }] },
      { id: 2, single: { id: 2 }, multi: [{ id: 2 }] },
    ]);
    expect(zsetA[1] as any).toEqual([create(nested), create(nested)]);
    expect(zsetA[1].single).toEqual([create(idShape), create(idShape)]);
    expect(zsetA[1].multi).toEqual([[create(idShape)], [create(idShape)]]);

    expect(zsetB[0]).toEqual([
      { id: 3, single: { id: 3 }, multi: [{ id: 3 }] },
      { id: 4, single: { id: 4 }, multi: [{ id: 4 }] },
    ]);
    expect(zsetB[1] as any).toEqual([create(nested), create(nested)]);
    expect(zsetB[1].single).toEqual([create(idShape), create(idShape)]);
    expect(zsetB[1].multi).toEqual([[create(idShape)], [create(idShape)]]);

    expect(zsetC[0]).toEqual([
      { id: 5, single: { id: 5 }, multi: [{ id: 5 }] },
    ]);
    expect(zsetC[1] as any).toEqual([create(nested)]);
    expect(zsetC[1].single).toEqual([create(idShape)]);
    expect(zsetC[1].multi).toEqual([[create(idShape)]]);
    expect(zsetA).toBe(zset);
  }
});

it("encodes primitive zset with legacy cardinality semantics", () => {
  const numbers: ZSet<number> = [[1], [1]];
  add(numbers, [[1], [-1]]);

  expect(numbers).toEqual([[1], [0]]);
  expect(cardinality(2)).toBe(2);
  expect(changed(-2)).toEqual([]);
});

it("encodes shaped create, remove, and update masks", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
    age: t.INT,
    email: t.STRING,
  }));

  expect(user.mask).toBe(7);
  expect(create(user)).toBe(0b1000);
  expect(create(user, 2)).toBe(0b1001);
  expect(remove(user)).toBe(-0b1000);
  expect(remove(user, 2)).toBe(-0b1001);
  expect(update(user)).toBe(0b111);
  expect(update(user, "name")).toBe(0b001);
  expect(update(user, "email")).toBe(0b100);

  expect(cardinality(create(user, 2), user)).toBe(2);
  expect(cardinality(update(user, "age"), user)).toBe(0);
  expect(changed(create(user), user)).toEqual([0, 1, 2]);
  expect(changed(update(user, "name", "email"), user)).toEqual([0, 2]);
  expect(changed(update(user, "email"), user, "email")).toBe(true);
  expect(changed(update(user, "email"), user, "age")).toBe(false);
  expect(changed(create(user), user, "name")).toBe(true);
});

it("compresses shaped zsets with ordered row-delta algebra", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
    age: t.INT,
    email: t.STRING,
  }));
  const row = { id: 1, name: "Ada", age: 37, email: "a@example.com" };

  const merge = (a: number, b: number) =>
    add([[row], [a], user], [[row], [b], user])[1][0];

  expect(merge(update(user, "name"), update(user, "age"))).toBe(0b011);
  expect(merge(update(user), update(user, "name"))).toBe(update(user));
  expect(merge(create(user), remove(user))).toBe(0);
  expect(merge(update(user, "name"), remove(user))).toBe(remove(user));
  expect(merge(create(user), update(user, "age"))).toBe(create(user));
  expect(merge(create(user), create(user))).toBe(create(user, 2));
});

it("does not copy absent fields from partial updates", () => {
  const note = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    likes: t.INT,
  }));

  const notes: ZSet<(typeof note)["~type"]> = [
    [{ id: 1, text: "hello", likes: 0 }],
    [0],
    note,
  ];

  add(notes, [[{ id: 1, text: "hello 2" }], [update(note)], note] as any);

  expect(notes).toEqual([
    [{ id: 1, text: "hello 2", likes: 0 }],
    [update(note)],
    note,
  ]);
});

it("supports 50 shaped fields without bitwise truncation", () => {
  const wide = {
    keys: ["id", ...Array.from({ length: 50 }, (_, i) => `f${i}`)],
    types: [16, ...Array(50).fill(0)],
    order: [0],
    hash: 0,
    mask: 2 ** 50 - 1,
    children: {},
  } as unknown as Shape<{ f48: unknown; f49: unknown }>;

  expect(update(wide, "f49")).toBe(2 ** 49);
  expect(create(wide)).toBe(2 ** 50);
  expect(cardinality(create(wide), wide)).toBe(1);
  expect(changed(update(wide, "f49"), wide)).toEqual([49]);
  expect(changed(update(wide, "f49"), wide, "f49")).toBe(true);
  expect(changed(update(wide, "f49"), wide, "f48")).toBe(false);
});

it("combines shaped change masks above 32 bits", () => {
  const wide = {
    keys: ["id", ...Array.from({ length: 50 }, (_, i) => `f${i}`)],
    types: [16, ...Array(50).fill(0)],
    order: [0],
    hash: 0,
    mask: 2 ** 50 - 1,
    children: {},
  } as unknown as Shape<{ f0: unknown; f33: unknown; f49: unknown }>;

  const low = update(wide, "f0");
  const high = update(wide, "f49");
  const high2 = update(wide, "f33");

  expect(combine(low, high, wide)).toBe(low + high);
  expect(combine(high, high2, wide)).toBe(high + high2);

  const row = { id: 1, f0: 1, f33: 33, f49: 49 } as (typeof wide)["~type"];
  const merged = add([[row], [high], wide], [[row], [high2], wide]);
  expect(merged[1][0]).toBe(high + high2);
  expect(changed(merged[1][0], wide)).toEqual([33, 49]);
});

it("accepts 50 non-primary fields and rejects 51", () => {
  const defineWide = (fields: number) =>
    shape((t) => ({
      id: t(t.INT, t.PRIMARY),
      ...Object.fromEntries(
        Array.from({ length: fields }, (_, i) => [`f${i}`, t.INT]),
      ),
    }));

  expect(() => defineWide(50)).not.toThrow();
  expect(() => defineWide(51)).toThrow("Too many non-primary fields: 51");
});

it("materializes partial source deltas", () => {
  const note = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    text: t.STRING,
    likes: t.INT,
  }));

  const set: ZSet<Partial<(typeof note)["~type"]>> = [
    [
      { id: 1, likes: 1 },
      { id: 2, likes: 2 },
      { id: 3 },
      { id: 4, text: "new", likes: 0 },
      { id: 5, text: "existing", likes: 1 },
      { id: 6 },
    ],
    [
      update(note),
      update(note),
      remove(note),
      create(note),
      create(note),
      remove(note),
    ],
    note,
  ];

  const current = [
    { id: 1, text: "hello", likes: 0 },
    { id: 3, text: "bye", likes: 0 },
    { id: 5, text: "existing", likes: 1 },
  ];

  expect(materialize(set, current)).toBe(set as ZSet<(typeof note)["~type"]>);
  expect(set).toEqual([
    [
      { id: 1, text: "hello", likes: 1 },
      { id: 3, text: "bye", likes: 0 },
      { id: 4, text: "new", likes: 0 },
    ],
    [update(note, "likes"), remove(note), create(note)],
    note,
  ]);
});

it("splits materialized relation updates into remove & create", () => {
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    user: t(t.INT, t.RELATION(1)),
    text: t.STRING,
  }));

  const set: ZSet<Partial<(typeof message)["~type"]>> = [
    [
      { id: 1, text: "hello!" },
      { id: 2, user: 2 },
      { id: 2, text: "layered" },
    ],
    [update(message), update(message, "user"), update(message, "text")],
    message,
  ];

  materialize(set, [
    { id: 1, user: 1, text: "hello" },
    { id: 2, user: 1, text: "move" },
  ]);

  expect(set).toEqual([
    [
      { id: 1, user: 1, text: "hello!" },
      { id: 2, user: 1, text: "move" },
      { id: 2, user: 2, text: "layered" },
    ],
    [update(message, "text"), remove(message), create(message)],
    message,
  ]);
});

it("materializes with consecutive splits", () => {
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    user: t(t.INT, t.RELATION(1)),
    text: t.STRING,
  }));

  const set: ZSet<Partial<(typeof message)["~type"]>> = [
    [
      { id: 1, user: 2 },
      { id: 2, user: 3 },
      { id: 3, user: 4 },
    ],
    [update(message), update(message), update(message)],
    message,
  ];

  materialize(set, [
    { id: 1, user: 1, text: "one" },
    { id: 2, user: 2, text: "two" },
    { id: 3, user: 3, text: "three" },
  ]);

  expect(set).toEqual([
    [
      { id: 1, user: 1, text: "one" },
      { id: 1, user: 2, text: "one" },
      { id: 2, user: 2, text: "two" },
      { id: 2, user: 3, text: "two" },
      { id: 3, user: 3, text: "three" },
      { id: 3, user: 4, text: "three" },
    ],
    [
      remove(message),
      create(message),
      remove(message),
      create(message),
      remove(message),
      create(message),
    ],
    message,
  ]);
});

it("materializes complex updates with noop operations", () => {
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    user: t(t.INT, t.RELATION(1)),
    text: t.STRING,
  }));

  const set: ZSet<Partial<(typeof message)["~type"]>> = [
    [
      { id: 1, text: "same" },
      { id: 2 },
      { id: 3, user: 4 },
      { id: 4, text: "must still be read" },
    ],
    [update(message), remove(message), update(message), update(message)],
    message,
  ];

  materialize(set, [
    { id: 1, user: 1, text: "same" },
    { id: 3, user: 3, text: "three" },
    { id: 4, user: 4, text: "four" },
  ]);

  expect(set).toEqual([
    [
      { id: 3, user: 3, text: "three" },
      { id: 3, user: 4, text: "three" },
      { id: 4, user: 4, text: "must still be read" },
    ],
    [remove(message), create(message), update(message, "text")],
    message,
  ]);
});

it("materializes already split deltas", () => {
  const item = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    value: t.INT,
  }));

  const set: ZSet<Partial<(typeof item)["~type"]>> = [
    [{ id: 1 }, { id: 1, value: 1 }],
    [remove(item), create(item)],
    item,
  ];

  expect(materialize(copy(set), [])).toEqual([
    [{ id: 1, value: 1 }],
    [create(item)],
    item,
  ]);

  expect(materialize(copy(set), [{ id: 1, value: 0 }])).toEqual([
    [{ id: 1, value: 1 }],
    [update(item, "value")],
    item,
  ]);

  expect(materialize(copy(set), [{ id: 1, value: 1 }])).toEqual([[], [], item]);
});

it("materializes multiple same primary key deltas", () => {
  const item = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    value: t.INT,
  }));

  const set: ZSet<Partial<(typeof item)["~type"]>> = [
    [{ id: 1 }, { id: 1, value: 1 }, { id: 1, value: 2 }],
    [remove(item), create(item), update(item, "value")],
    item,
  ];

  expect(materialize(copy(set), [])).toEqual([
    [{ id: 1, value: 2 }],
    [create(item)],
    item,
  ]);

  expect(materialize(copy(set), [{ id: 1, value: 0 }])).toEqual([
    [{ id: 1, value: 2 }],
    [update(item, "value")],
    item,
  ]);

  expect(materialize(copy(set), [{ id: 1, value: 2 }])).toEqual([[], [], item]);
});

it("adds with different identity parameters", () => {
  const message = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    user: t(t.INT, t.RELATION(1)),
    text: t.STRING,
  }));

  const oldRow = { id: 1, user: 1, text: "hello" };
  const newRow = { id: 1, user: 2, text: "hello" };

  const relationDelta = add(
    [[oldRow], [remove(message)], message],
    [[newRow], [create(message)], message],
    { identity: "relations" },
  );

  expect(relationDelta).toEqual([
    [oldRow, newRow],
    [remove(message), create(message)],
    message,
  ]);

  const primaryDelta = add(
    [[oldRow], [remove(message)], message],
    [[newRow], [create(message)], message],
  );

  expect(primaryDelta).toEqual([[newRow], [0], message]);
});

const rowShape = shape((t) => ({
  id: t(t.INT, t.PRIMARY),
  text: t.STRING,
  value: t.INT,
}));

type Row = { id: number; text: string; value: number };
type Parent = Row & { kids: Row[] };

const row = (id: number, value = id) => ({ id, text: String(value), value });

function random(seed: number) {
  return () => (seed = Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

it("integrates field updates, deletions, and creations", () => {
  const s = rowShape;
  const view: ZSet<Row> = [
    [row(1), row(2), row(3)],
    Array(3).fill(create(s)),
    s,
  ];
  const delta: ZSet<Row> = [
    [row(1, 10), row(2), row(3, 30), row(4)],
    [update(s, "value"), remove(s), update(s, "text"), create(s, 2)],
    s,
  ];

  integrate(view, delta);

  expect(view).toEqual([
    [{ id: 1, text: "1", value: 10 }, { id: 3, text: "30", value: 3 }, row(4)],
    Array(3).fill(create(s)),
    s,
  ]);
});

it("integrates mixed batches in ascending and descending order", () => {
  const rand = random(43);

  for (const s of [rowShape, reorder(rowShape, ["id", "desc"])]) {
    const rows = Array.from({ length: 51 }, (_, id) => row(id * 2, id));
    rows.sort((a, b) => compare(a, b, s));
    let view: ZSet<Row> = [rows, rows.map(() => create(s)), s];
    const upd = [update(s, "value"), update(s, "text"), create(s), remove(s)];

    for (let round = 0; round < 400; round++) {
      const rows = Array.from({ length: 1 + (rand() % 15) }, () =>
        row((rand() % 110) * 2, round + 110),
      ).sort((a, b) => compare(a, b, s));

      const delta: ZSet<Row> = [rows, rows.map(() => upd[rand() % 4]), s];

      const expected = distinct(add(copy(view), copy(delta)));
      view = integrate(view, copy(delta));

      expect(view).toEqual(expected);
    }
  }
});

it.each([0, 2, 4])("ignores absent parent deletions (%i)", (id) => {
  const parent = nest(rowShape, "kids", rowShape);
  const rows = [1, 3].map((id) => ({ ...row(id), kids: [row(1)] }));

  const meta = rows.map(() => create(parent)) as Meta<Parent, number>;
  meta.kids = rows.map(() => [create(rowShape)]);
  const view: ZSet<Parent> = [rows, meta, parent];

  const deltaMeta = [remove(parent)] as Meta<Parent, number>;
  deltaMeta.kids = [[]];
  const delta: ZSet<Parent> = [[{ ...row(id), kids: [] }], deltaMeta, parent];

  const actual = integrate(copy(view), delta);

  expect(actual).toEqual(view);
  expect(actual[1].kids).toEqual(view[1].kids);
});

it("integrates mixed parent and child batches", () => {
  const rand = random(91);
  const parent = nest(rowShape, "kids", rowShape);
  const data = Array.from({ length: 128 }, (_, id) => ({
    ...row(id, 0),
    kids: [row(1)],
  }));

  const meta = data.map(() => create(parent)) as Meta<Parent, number>;
  meta.kids = data.map(() => [create(rowShape)]);
  let view: ZSet<Parent> = [data, meta, parent];
  const upd = [create(parent), remove(parent), update(parent)];

  for (let round = 0; round < 200; round++) {
    const ids = [
      ...new Set(Array.from({ length: 8 }, () => rand() % 150)),
    ].sort((a, b) => a - b);
    const rows = ids.map((id) => ({
      ...row(id, round),
      kids: [{ ...row(1, round), text: String(rand()) }, row(3, round)],
    }));

    const meta = ids.map(() => upd[rand() % 3]) as Meta<Parent, number>;
    meta.kids = ids.map(() => [update(rowShape), create(rowShape)]);

    const delta: ZSet<Parent> = [rows, meta, parent];
    const expected = distinct(add(copy(view), copy(delta)));
    view = integrate(view, copy(delta));

    expect(view).toEqual(expected);
    expect(view[1].kids).toEqual(expected[1].kids);
  }
});
