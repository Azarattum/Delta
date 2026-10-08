import { expect, it } from "bun:test";
import { cyrb53, uint53 } from "./id";

it("generates unsigned 53-bit IDs", () => {
  for (let i = 0; i < 100; i++) {
    const id = uint53();
    expect(Number.isSafeInteger(id)).toBe(true);
    expect(id).toBeGreaterThanOrEqual(0);
  }
});

it("hashes strings to stable 53-bit IDs", () => {
  expect(cyrb53("something to hash")).toBe(2109683571066041);
  expect(cyrb53("something to hash")).not.toBe(cyrb53("something else"));
});
