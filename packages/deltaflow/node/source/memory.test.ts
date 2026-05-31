import { expect, it } from "bun:test";
import { memory } from "./memory";
import type { Order } from "../../datastructure/shape";

type Row = {
  id: number;
  x: number;
  y: number;
  z: number;
  parent: number;
  text: string;
};

const rows: Row[] = [
  { id: 0, x: 0, y: 10, z: 0, parent: 1, text: "zero" },
  { id: 1, x: 0, y: 10, z: 5, parent: 1, text: "one" },
  { id: 2, x: 0, y: 5, z: 2, parent: 1, text: "two" },
  { id: 3, x: 1, y: 9, z: 1, parent: 2, text: "three" },
  { id: 4, x: 1, y: 9, z: 4, parent: 2, text: "four" },
  { id: 5, x: 1, y: 7, z: 3, parent: 2, text: "five" },
  { id: 6, x: 2, y: 3, z: 0, parent: 3, text: "six" },
];

it("mutates and queries rows", () => {
  const store = memory<Row>()(["id"]);
  store.mutate({ creates: rows.slice(0, 3) });
  store.mutate({
    creates: [{ id: 3, x: 1, y: 9, z: 1, parent: 2, text: "three" }],
    updates: [{ id: 1, text: "ONE" }],
    removes: [{ id: 2 }],
  });

  const result = store.query({ order: ["id"] });
  expect(result).toEqual([
    { id: 0, x: 0, y: 10, z: 0, parent: 1, text: "zero" },
    { id: 1, x: 0, y: 10, z: 5, parent: 1, text: "ONE" },
    { id: 3, x: 1, y: 9, z: 1, parent: 2, text: "three" },
  ]);

  result[0].text = "mutated copy";
  expect(store.query({ order: ["id"] })[0].text).toBe("zero");
});

it("supports filters, totals, and cursor pagination", () => {
  const store = memory<Row>()(["id"]);
  store.mutate({ creates: rows });

  const total = { out: 0 };
  const filtered = store.query({
    order: ["id"],
    total,
    filter: [
      { keys: [["parent"], ["id"]], items: [{ id: 2 }] },
      { keys: [["id"]], items: [{ id: 4 }], exclude: true },
    ],
  });
  expect(filtered.map((row) => row.id)).toEqual([3, 5]);
  expect(total.out).toBe(2);

  const sortOrder: Order<Row> = [
    ["x", "asc"],
    ["y", "desc"],
    ["z", "asc"],
  ];

  expect(
    store
      .query({
        cursor: {
          anchor: { id: 1, x: 0, y: 10, z: 5 } as Row,
          offset: 0,
          count: 3,
          exclusive: true,
        },
        order: sortOrder,
      })
      .map((row) => row.id),
  ).toEqual([2, 3, 4]);

  expect(
    store
      .query({
        cursor: {
          anchor: { id: 3, x: 1, y: 9, z: 1 } as Row,
          count: -2,
          exclusive: true,
        },
        order: sortOrder,
      })
      .map((row) => row.id),
  ).toEqual([1, 2]);

  expect(
    store
      .query({
        cursor: { offset: 1, count: -2 },
        order: sortOrder,
      })
      .map((row) => row.id),
  ).toEqual([4, 5]);
});
