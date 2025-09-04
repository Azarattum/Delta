import { it, expect } from "bun:test";
import { Shared } from "./shared";

it("initializes with the correct current value", () => {
  const a = new Shared("A");
  const b = new Shared("B");
  expect(a.current).toBe("A");
  expect(b.current).toBe("B");
});

it("joins makes current shared between nodes", () => {
  const a = new Shared("A");
  const b = new Shared("B");
  Shared.join(a, b);
  expect(a.current).toBe("A");
  expect(b.current).toBe("A");
  b.current = "B2";
  expect(a.current).toBe("B2");
  expect(b.current).toBe("B2");
});

it("joins between clusters", () => {
  const a = new Shared("A");
  const b = new Shared("B");
  const c = new Shared("C");
  Shared.join(a, b);
  expect(a.current).toBe("A");
  expect(b.current).toBe("A");
  expect(c.current).toBe("C");
  Shared.join(c, b);
  expect(a.current).toBe("C");
  expect(b.current).toBe("C");
  expect(c.current).toBe("C");
});

it("keeps the entire cluster updated", () => {
  const a = new Shared("A");
  const b = new Shared("B");
  const c = new Shared("C");
  Shared.join(a, b);
  Shared.join(c, b);
  a.current = "Z";
  expect(a.current).toBe("Z");
  expect(b.current).toBe("Z");
  expect(c.current).toBe("Z");
  c.current = "Y";
  expect(a.current).toBe("Y");
  expect(b.current).toBe("Y");
  expect(c.current).toBe("Y");
});

it("keeps unjoined nodes independent", () => {
  const a = new Shared("A");
  const b = new Shared("B");
  const c = new Shared("C");
  a.current = "A2";
  b.current = "B2";
  c.current = "C2";
  expect(a.current).toBe("A2");
  expect(b.current).toBe("B2");
  expect(c.current).toBe("C2");
});
