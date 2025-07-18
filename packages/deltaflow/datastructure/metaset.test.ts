import { traverse, type MetaSet, type Visitors } from "./metaset";
import { nest, shape } from "./shape";
import { expect, it, mock } from "bun:test";

const idShape = shape((t) => ({ id: t(t.INT, t.PRIMARY) }));

it("traverses flat numeric set with item visitor", () => {
  const set: MetaSet<number, string> = [
    [1, 2, 3],
    ["a", "b", "c"],
  ];

  const visitors: Visitors<typeof set> = {
    each: (data, meta) => [data * 2, meta.toUpperCase()],
  };

  traverse(visitors, set);

  expect(set[0]).toEqual([2, 4, 6]);
  expect(set[1]).toEqual(["A", "B", "C"]);
});

it("applies container visitor to flat object set", () => {
  let set: MetaSet<{ id: number }, number> = [
    [{ id: 1 }, { id: 2 }],
    [10, 20],
    idShape,
  ];

  const visitors: Visitors<typeof set> = {
    container: (container): any =>
      container.map((x) =>
        typeof x === "number" ? x + 1
        : typeof x === "object" && x && "id" in x && typeof x.id === "number" ?
          { ...x, id: x.id + 1 }
        : x,
      ),
  };

  traverse(visitors, set);

  expect(set[0]).toEqual([{ id: 2 }, { id: 3 }]);
  expect(set[1]).toEqual([11, 21]);
});

it("applies container visitor to deep object set", () => {
  const detailShape = shape((t) => ({ id: t(t.INT) }));
  const userShape = nest(idShape, "details", detailShape);

  const set: MetaSet<(typeof userShape)["~type"], number> = [
    [
      { id: 1, details: [{ id: 25 }] },
      { id: 2, details: [{ id: 30 }] },
    ],
    Object.assign([1, 2], { details: [[3], [4]] }),
    userShape,
  ];

  const visitors: Visitors<typeof set> = {
    container: mock((container) => container),
  };

  traverse(visitors, set);
  expect(visitors.container).toHaveReturnedTimes(7);
});

it("merges sets without combine function", () => {
  const setA: MetaSet<number, string> = [
    [1, 3],
    ["a", "c"],
  ];
  const setB: MetaSet<number, string> = [
    [2, 4],
    ["b", "d"],
  ];
  const setC: MetaSet<number, string> = [[5], ["e"]];

  const visitors: Visitors<typeof setA> = {
    each: (data, meta) => [data * 10, meta.toUpperCase()],
  };

  traverse(visitors, setA, setB, setC);

  expect(setA[0]).toEqual([10, 20, 30, 40, 50]);
  expect(setA[1]).toEqual(["A", "B", "C", "D", "E"]);
});

it("merges and combines sets", () => {
  const setA: MetaSet<number, number> = [
    [1, 3],
    [10, 30],
  ];
  const setB: MetaSet<number, number> = [
    [2, 3],
    [20, 30],
  ];

  const visitors: Visitors<typeof setA> = {
    combine: (aData, aMeta, bData, bMeta) => [aData ?? bData, aMeta + bMeta],
    each: (data, meta) => [data * 2, meta + 1],
  };

  traverse(visitors, setA, setB);

  expect(setA[0]).toEqual([2, 4, 6]);
  expect(setA[1]).toEqual([11, 21, 61]);
});

it("merges sets deeply with children", () => {
  const detailShape = shape((t) => ({ id: t(t.INT, t.PRIMARY) }));
  const postShape = shape((t) => ({ id: t(t.INT, t.PRIMARY) }));
  const userShape = nest(
    nest(idShape, "details", detailShape, true),
    "posts",
    postShape,
  );

  const setA: MetaSet<(typeof userShape)["~type"], number> = [
    [
      { id: 1, details: { id: 25 }, posts: [{ id: 100 }, { id: 200 }] },
      { id: 3, details: { id: 30 }, posts: [{ id: 150 }] },
    ],
    Object.assign([1, 2], { details: [3, 4], posts: [[5, 6], [7]] }),
    userShape,
  ];
  const setB: MetaSet<(typeof userShape)["~type"], number> = [
    [
      { id: 2, details: { id: 35 }, posts: [{ id: 200 }] },
      { id: 3, details: { id: 40 }, posts: [{ id: 350 }] },
    ],
    Object.assign([1, 2], { details: [3, 4], posts: [[5], [7]] }),
    userShape,
  ];

  const visitors: Visitors<typeof setA> = {
    combine: (aData, aMeta, bData, bMeta) => [
      { ...aData, id: aData.id + bData.id },
      aMeta + bMeta,
    ],
  };

  traverse(visitors, setA, setB);

  expect(setA[0]).toEqual([
    { id: 1, details: { id: 25 }, posts: [{ id: 100 }, { id: 200 }] },
    { id: 2, details: { id: 35 }, posts: [{ id: 200 }] },
    { id: 6, details: { id: 70 }, posts: [{ id: 150 }, { id: 350 }] },
  ]);
  expect({ ...setA[1] }).toEqual({
    ...Object.assign([1, 1, 4], {
      posts: [[5, 6], [5], [7, 7]],
      details: [3, 3, 8],
    }),
  });
});

it("handles nested singular relationships", () => {
  const detailShape = shape((t) => ({ id: t(t.INT) }));
  const userShape = nest(idShape, "details", detailShape, true);

  const set: MetaSet<(typeof userShape)["~type"], number> = [
    [
      { id: 1, details: { id: 25 } },
      { id: 2, details: { id: 30 } },
    ],
    Object.assign([1, 2], { details: [3, 4] }),
    userShape,
  ];

  const visitors: Visitors<typeof set> = {
    each: (data, meta) => [{ ...data, id: data.id * 10 }, (meta + 1) * 2],
  };

  traverse(visitors, set);

  expect(set[0]).toEqual([
    { id: 10, details: { id: 250 } },
    { id: 20, details: { id: 300 } },
  ]);
  expect({ ...set[1] }).toEqual({
    ...Object.assign([4, 6], { details: [8, 10] }),
  });
});

it("handles nested collection relationships", () => {
  const postShape = shape((t) => ({ content: t.STRING }));
  const userShape = nest(idShape, "posts", postShape);

  const set: MetaSet<(typeof userShape)["~type"], { count: number }> = [
    [
      { id: 1, posts: [{ content: "A" }, { content: "B" }] },
      { id: 2, posts: [{ content: "C" }] },
    ],
    Object.assign([{ count: 1 }, { count: 2 }], {
      posts: [[{ count: 1 }, { count: 2 }], [{ count: 3 }]],
    }),
    userShape,
  ];

  const visitors: Visitors<typeof set> = {
    each: (data, meta) => [data, { count: meta.count * 2 + 1 }],
  };

  traverse(visitors, set);

  expect(set[0]).toEqual([
    { id: 1, posts: [{ content: "A" }, { content: "B" }] },
    { id: 2, posts: [{ content: "C" }] },
  ]);
  expect({ ...set[1] }).toEqual({
    ...Object.assign([{ count: 3 }, { count: 5 }], {
      posts: [[{ count: 3 }, { count: 5 }], [{ count: 7 }]],
    }),
  });
});

it("processes empty set without errors", () => {
  const set: MetaSet<number, string> = [[], []];
  const visitors: Visitors<typeof set> = {
    each: (data, meta) => [data, meta],
    container: (container) => container,
  };
  expect(() => traverse(visitors, set)).not.toThrow();
  expect(set[0]).toEqual([]);
});

it("handles mixed primitive and object metadata", () => {
  const set: MetaSet<number, number | string> = [
    [1, 2, 3],
    [10, "20", 30],
  ];

  const visitors: Visitors<typeof set> = {
    each: (data, meta) => [
      data * 2,
      typeof meta === "string" ? meta + "!" : meta * 2,
    ],
  };

  traverse(visitors, set);

  expect(set[0]).toEqual([2, 4, 6]);
  expect(set[1]).toEqual([20, "20!", 60]);
});

it("merges children of singular items", () => {
  const user = shape((t) => ({
    id: t(t.INT, t.PRIMARY),
    name: t.STRING,
  }));

  const deep = nest(idShape, "details", nest(idShape, "users", user), true);

  const set1: MetaSet<(typeof deep)["~type"], number> = [
    [
      { id: 1, details: { id: 10, users: [{ id: 100, name: "John" }] } },
      { id: 2, details: { id: 20, users: [{ id: 200, name: "Jane" }] } },
    ],
    Object.assign([1, 1], {
      details: Object.assign([2, 2], { users: [[31], [32]] }),
    }),
    deep,
  ];

  const set2: MetaSet<(typeof deep)["~type"], number> = [
    [
      { id: 1, details: { id: 10, users: [{ id: 100, name: "John 2" }] } },
      { id: 2, details: { id: 20, users: [{ id: 300, name: "Janette" }] } },
    ],
    Object.assign([1, 1], {
      details: Object.assign([2, 2], { users: [[33], [34]] }),
    }),
    deep,
  ];

  const visitors = {
    combine: mock((data, meta) => [data, meta]),
  } as unknown as Visitors<typeof set1>;

  traverse(visitors, set1, set2);

  expect(set1).toEqual([
    [
      { id: 1, details: { id: 10, users: [{ id: 100, name: "John" }] } },
      {
        id: 2,
        details: {
          id: 20,
          users: [
            { id: 200, name: "Jane" },
            { id: 300, name: "Janette" },
          ],
        },
      },
    ],
    Object.assign([1, 1], {
      details: Object.assign([2, 2], { users: [[31], [32, 34]] }),
    }),
    deep,
  ]);

  expect(visitors.combine).toHaveBeenCalledTimes(5);
});

it("merges complex nested structures", () => {
  const complex = nest(
    idShape,
    "inner",
    nest(nest(idShape, "inner", idShape, true), "posts", idShape),
    true,
  );

  const set1: MetaSet<(typeof complex)["~type"], number> = [
    [
      {
        id: 1,
        inner: {
          id: 10,
          inner: { id: 100 },
          posts: [{ id: 1000 }, { id: 1001 }],
        },
      },
      { id: 2, inner: { id: 20, inner: { id: 200 }, posts: [{ id: 2000 }] } },
      { id: 3, inner: { id: 30, inner: { id: 300 }, posts: [{ id: 3001 }] } },
    ],
    Object.assign([1, 1, 1], {
      inner: Object.assign([3, 2, 1], {
        inner: [1, 1, 1],
        posts: [[1, 1], [1], [1]],
      }),
    }),
    complex,
  ];

  const set2: MetaSet<(typeof complex)["~type"], number> = [
    [
      { id: 2, inner: { id: 20, inner: { id: 200 }, posts: [{ id: 2001 }] } },
      { id: 4, inner: { id: 40, inner: { id: 400 }, posts: [{ id: 4001 }] } },
    ],
    Object.assign([1, 1], {
      inner: Object.assign([1, 1], { inner: [1, 1], posts: [[1], [1]] }),
    }),
    complex,
  ];

  const visitors: Visitors<typeof set1> = {
    combine: (data, meta) => [data, meta],
  };

  traverse(visitors, set1, set2);

  expect(set1[0]).toEqual([
    {
      id: 1,
      inner: {
        id: 10,
        inner: { id: 100 },
        posts: [{ id: 1000 }, { id: 1001 }],
      },
    },
    {
      id: 2,
      inner: {
        id: 20,
        inner: { id: 200 },
        posts: [{ id: 2000 }, { id: 2001 }],
      },
    },
    { id: 3, inner: { id: 30, inner: { id: 300 }, posts: [{ id: 3001 }] } },
    { id: 4, inner: { id: 40, inner: { id: 400 }, posts: [{ id: 4001 }] } },
  ]);

  expect(set1[1]).toEqual([1, 1, 1, 1] as any);
  expect(set1[1].inner).toEqual([3, 2, 1, 1] as any);
  expect(set1[1].inner.inner).toEqual([1, 1, 1, 1]);
  expect(set1[1].inner.posts).toEqual([[1, 1], [1, 1], [1], [1]]);
});

it("traverses children of singular items", () => {
  const deep = nest(
    idShape,
    "details",
    nest(idShape, "details", idShape, true),
    true,
  );

  const set: MetaSet<(typeof deep)["~type"], number> = [
    [
      { id: 1, details: { id: 10, details: { id: 100 } } },
      { id: 2, details: { id: 20, details: { id: 200 } } },
    ],
    Object.assign([1, 1], {
      details: Object.assign([2, 2], { details: [3, 3] }),
    }),
    deep,
  ];

  const visitors = {
    container: mock((container) => container),
    each: mock((data, meta) => [data, meta]),
  } as unknown as Visitors<typeof set>;

  traverse(visitors, set);
  expect(visitors.each).toHaveBeenCalledTimes(6);
  expect(visitors.container).toHaveBeenCalledTimes(3);
  expect(visitors.each).toHaveBeenLastCalledWith({ id: 200 }, 3);
});
