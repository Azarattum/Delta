import { TRACE, instrumentPull, formatRangeTrace } from "../debug/trace";
import { add, distinct } from "../datastructure/zset";
import type { ZSet } from "../datastructure/zset";
import { describe, expect, it } from "bun:test";
import type { StepTrace } from "../debug/trace";
import { shape } from "../datastructure/shape";
import { sqlite } from "./source/sqlite";
import { limit, range } from "./range";
import { fullGC } from "bun:jsc";
import SQLite from "bun:sqlite";

const idShape = shape((t) => ({ id: t(t.DOUBLE, t.PRIMARY) }));

describe("single adds", () => {
  const data = [1, 2, 3, 4, 5, 6];
  const positions = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5];

  for (const lim of [1, 2, 3, 4, 6, 10]) {
    for (const off of [0, 1, 2, 3, 5]) {
      for (const id of positions) {
        it(`+${id} [${off}:${off + lim}]`, () => {
          run(data, lim, off, [step(`+${id}`)]);
        });
      }
    }
  }
});

describe("single removes", () => {
  const data = [1, 2, 3, 4, 5, 6];

  for (const lim of [1, 2, 3, 4, 6, 10]) {
    for (const off of [0, 1, 2, 3, 5]) {
      for (const id of data) {
        it(`-${id} [${off}:${off + lim}]`, () => {
          run(data, lim, off, [step(`-${id}`)]);
        });
      }
    }
  }
});

describe("single updates", () => {
  const data = [1, 2, 3, 4, 5, 6];

  for (const lim of [2, 3, 4, 10]) {
    for (const off of [0, 1, 2]) {
      for (const id of data) {
        it(`~${id} [${off}:${off + lim}]`, () => {
          run(data, lim, off, [step(`~${id}`)]);
        });
      }
    }
  }
});

describe("paired operations", () => {
  const data = [1, 2, 3, 4, 5, 6];
  const pairs: string[] = [
    // add + remove (net zero)
    "+1.5 -2",
    "+2.5 -3",
    "-4 +4.5",
    "+0.5 -1",
    "-6 +5.5",
    // add + add
    "+1.5 +2.5",
    "+0.5 +6.5",
    "+3.5 +4.5",
    // remove + remove
    "-1 -2",
    "-3 -4",
    "-5 -6",
    "-1 -6",
    // add + update
    "+1.5 ~3",
    "+2.5 ~4",
    // remove + update
    "-2 ~3",
    "-2 ~4",
    "-3 ~4",
    // two adds + one remove
    "+0.5 -1 +1.5",
    "+1.5 +2.5 -3",
    // one add + two removes
    "-1 -2 +3.5",
    "-3 -4 +5.5",
    // three adds
    "+1.5 +2.5 +3.5",
    "+0.5 +3.5 +6.5",
    // three removes
    "-1 -2 -3",
    "-4 -5 -6",
    // mixed across all regions
    "+0.5 -1 +2.5 -4 +5.5 -6",
    "-1 -2 +3.5 +5.5",
  ];

  for (const d of pairs) {
    for (const lim of [1, 2, 3, 4, 10]) {
      for (const off of [0, 1, 2, 3]) {
        it(`${d} [${off}:${off + lim}]`, () => {
          run(data, lim, off, [step(d)]);
        });
      }
    }
  }
});

describe("window shift right", () => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8];

  for (const off of [0, 1, 2, 3]) {
    for (const lim of [1, 2, 3, 4]) {
      for (const shift of [1, 2, 3, 5]) {
        it(`[${off}:${off + lim}] → [${off + shift}:${off + shift + lim}]`, () => {
          run(data, lim, off, [{ offset: off + shift }]);
        });
      }
    }
  }
});

describe("window shift left", () => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8];

  for (const off of [2, 3, 4, 5]) {
    for (const lim of [1, 2, 3]) {
      for (const shift of [1, 2, 3]) {
        const no = Math.max(0, off - shift);
        it(`[${off}:${off + lim}] → [${no}:${no + lim}]`, () => {
          run(data, lim, off, [{ offset: no }]);
        });
      }
    }
  }
});

describe("window grow", () => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8];

  for (const off of [0, 1, 2]) {
    for (const lim of [1, 2, 3]) {
      for (const grow of [1, 2, 3]) {
        it(`limit ${lim}→${lim + grow} at offset ${off}`, () => {
          run(data, lim, off, [{ limit: lim + grow }]);
        });
      }
    }
  }
});

describe("window shrink", () => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8];

  for (const off of [0, 1, 2]) {
    for (const lim of [2, 3, 4, 5]) {
      for (const shrink of [1, 2, 3]) {
        const nl = Math.max(0, lim - shrink);
        it(`limit ${lim}→${nl} at offset ${off}`, () => {
          run(data, lim, off, [{ limit: nl }]);
        });
      }
    }
  }
});

describe("window combined offset + limit", () => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8];
  const cases: [number, number, number, number][] = [
    [3, 1, 2, 2],
    [2, 2, 3, 1],
    [3, 1, 3, 3],
    [2, 3, 4, 1],
    [3, 0, 1, 5],
    [5, 2, 1, 0],
    [2, 0, 2, 6],
    [3, 2, 0, 0],
    [3, 2, 0, 5],
  ];

  for (const [il, io, nl, no] of cases) {
    it(`[${io}:${io + il}] → [${no}:${no + nl}]`, () => {
      run(data, il, io, [{ limit: nl, offset: no }]);
    });
  }
});

describe("add while shifting right", () => {
  const data = [10, 20, 30, 40, 50, 60, 70, 80];
  const ops = ["+15", "+35", "+55", "+5", "+85", "+25 +45", "+35 +65"];

  for (const d of ops) {
    for (const shift of [1, 2, 3]) {
      it(`${d} + shift right by ${shift} from [2:5]`, () => {
        run(data, 3, 2, [step(d, { offset: 2 + shift })]);
      });
    }
  }
});

describe("remove while shifting right", () => {
  const data = [10, 20, 30, 40, 50, 60, 70, 80];
  const ops = ["-10", "-30", "-40", "-50", "-60", "-10 -30", "-40 -50"];

  for (const d of ops) {
    for (const shift of [1, 2]) {
      it(`${d} + shift right by ${shift} from [2:5]`, () => {
        run(data, 3, 2, [step(d, { offset: 2 + shift })]);
      });
    }
  }
});

describe("add while shifting left", () => {
  const data = [10, 20, 30, 40, 50, 60, 70, 80];
  const ops = ["+15", "+45", "+55", "+75"];

  for (const d of ops) {
    for (const shift of [1, 2]) {
      it(`${d} + shift left by ${shift} from [3:6]`, () => {
        run(data, 3, 3, [step(d, { offset: 3 - shift })]);
      });
    }
  }
});

describe("add while growing", () => {
  const data = [10, 20, 30, 40, 50, 60, 70, 80];
  const ops = ["+25", "+45", "+65", "+25 +55"];

  for (const d of ops) {
    for (const grow of [1, 2, 3]) {
      it(`${d} + grow by ${grow} from [1:3]`, () => {
        run(data, 2, 1, [step(d, { limit: 2 + grow })]);
      });
    }
  }
});

describe("remove while shrinking", () => {
  const data = [10, 20, 30, 40, 50, 60, 70, 80];
  const ops = ["-30", "-50", "-10", "-30 -50"];

  for (const d of ops) {
    for (const shrink of [1, 2]) {
      it(`${d} + shrink by ${shrink} from [1:5]`, () => {
        run(data, 4, 1, [step(d, { limit: Math.max(0, 4 - shrink) })]);
      });
    }
  }
});

describe("mixed delta + window change", () => {
  const data = [10, 20, 30, 40, 50, 60, 70, 80];
  const cases: [string, number, number][] = [
    ["+15", 2, 3],
    ["-40", 4, 1],
    ["+25 +35 +55", 3, 4],
    ["-30 -50 -60", 3, 0],
    ["+25 -40", 3, 3],
    ["+85", 1, 2],
    ["+5 +25 +45 +65 +85", 3, 5],
    ["+25", 0, 2],
    ["~30 ~50", 3, 3],
  ];

  for (const [d, nl, no] of cases) {
    it(`${d} → [${no}:${no + nl}]`, () => {
      run(data, 3, 2, [step(d, { limit: nl, offset: no })]);
    });
  }
});

describe("multi-step", () => {
  it("alternating adds and removes", () => {
    run([1, 2, 3, 4, 5], 3, 1, [
      step("+1.5"),
      step("-2"),
      step("+3.5"),
      step("-4"),
      step("+2.5"),
    ]);
  });

  it("progressive shift right", () => {
    run([1, 2, 3, 4, 5, 6, 7, 8], 3, 0, [
      { offset: 1 },
      { offset: 2 },
      { offset: 3 },
      { offset: 4 },
      { offset: 5 },
      { offset: 6 },
    ]);
  });

  it("progressive shift left", () => {
    run([1, 2, 3, 4, 5, 6, 7, 8], 3, 5, [
      { offset: 4 },
      { offset: 3 },
      { offset: 2 },
      { offset: 1 },
      { offset: 0 },
    ]);
  });

  it("grow then shrink", () => {
    run([1, 2, 3, 4, 5, 6], 2, 1, [
      { limit: 3 },
      { limit: 4 },
      { limit: 5 },
      { limit: 4 },
      { limit: 3 },
      { limit: 2 },
      { limit: 1 },
    ]);
  });

  it("add between shifts", () => {
    run([1, 2, 3, 4, 5], 2, 1, [
      step("+1.5"),
      { offset: 2 },
      step("+3.5"),
      { offset: 3 },
      step("+5.5"),
    ]);
  });

  it("remove between shifts", () => {
    run([1, 2, 3, 4, 5, 6, 7, 8], 3, 2, [
      step("-3"),
      { offset: 1 },
      step("-5"),
      { offset: 0 },
      step("-7"),
    ]);
  });

  it("add + shift each step", () => {
    run([10, 20, 30, 40, 50], 2, 1, [
      step("+15", { offset: 2 }),
      step("+35", { offset: 3 }),
      step("+55", { offset: 4 }),
    ]);
  });

  it("remove + shift each step", () => {
    run([10, 20, 30, 40, 50, 60, 70], 3, 2, [
      step("-30", { offset: 1 }),
      step("-20", { offset: 0 }),
      step("-10", { offset: 0 }),
    ]);
  });

  it("build up from empty then tear down", () => {
    run([], 3, 0, [
      step("+1"),
      step("+2"),
      step("+3"),
      step("+4"),
      step("-3"),
      step("-2"),
      step("-1"),
    ]);
  });

  it("fill with offset then shift", () => {
    run([], 2, 2, [
      step("+1"),
      step("+2"),
      step("+3"),
      step("+4"),
      step("+5"),
      { offset: 0 },
    ]);
  });
});

describe("boundary operations", () => {
  const data = [1, 2, 3, 4, 5, 6];

  describe("at lower bound", () => {
    it("remove at lower", () => run(data, 2, 2, [step("-3")]));
    it("remove below lower", () => run(data, 2, 2, [step("-2")]));
    it("add below lower", () => run(data, 2, 2, [step("+2.5")]));
    it("add above lower", () => run(data, 2, 2, [step("+3.5")]));
    it("update at lower", () => run(data, 2, 2, [step("~3")]));
  });

  describe("at upper bound", () => {
    it("remove at upper", () => run(data, 2, 2, [step("-4")]));
    it("remove above upper", () => run(data, 2, 2, [step("-5")]));
    it("add above upper", () => run(data, 2, 2, [step("+4.5")]));
    it("add below upper", () => run(data, 2, 2, [step("+3.5")]));
    it("update at upper", () => run(data, 2, 2, [step("~4")]));
  });

  describe("both bounds", () => {
    it("remove both", () => run(data, 2, 2, [step("-3 -4")]));
    it("update both", () => run(data, 2, 2, [step("~3 ~4")]));
    it("remove lower + update upper", () => run(data, 2, 2, [step("-3 ~4")]));
    it("update lower + remove upper", () => run(data, 2, 2, [step("~3 -4")]));
    it("add below + remove upper", () => run(data, 2, 2, [step("+2.5 -4")]));
    it("remove lower + add above", () => run(data, 2, 2, [step("-3 +4.5")]));
    it("add below + add above (saturated)", () =>
      run(data, 2, 2, [step("+2.5 +4.5")]));
  });
});

describe("shift scenarios", () => {
  it("shrink both: add below pushes out upper", () => {
    run([1, 2, 3, 4, 5], 2, 2, [step("+1.5")]);
  });

  it("shrink both: multiple adds below", () => {
    run([1, 2, 3, 4, 5], 2, 2, [step("+1.5 +2.5")]);
  });

  it("expand lower: add below + remove within", () => {
    run([1, 2, 3, 4, 5], 2, 2, [step("+1.5 -3")]);
  });

  it("contract lower: remove below (unbounded)", () => {
    run([1, 2, 3, 4, 5], 10, 2, [step("-1")]);
  });

  it("expand both: remove below (bounded)", () => {
    run([1, 2, 3, 4, 5, 6], 2, 2, [step("-1")]);
  });

  it("expand both: remove below + remove at lower", () => {
    run([1, 2, 3, 4, 5, 6], 2, 2, [step("-2 -3")]);
  });

  it("contract upper: add within", () => {
    run([1, 2, 3, 4, 5], 3, 0, [step("+2.5")]);
  });

  it("expand upper: remove within (bounded)", () => {
    run([1, 2, 3, 4, 5], 3, 0, [step("-2")]);
  });

  it("expand upper: remove at upper", () => {
    run([1, 2, 3, 4, 5], 3, 0, [step("-3")]);
  });
});

describe("combine callback", () => {
  it("update at item pulled into lower", () => {
    run([1, 2, 3, 4, 5], 3, 1, [step("+0.5 ~1")]);
  });

  it("update at item pulled into upper", () => {
    run([1, 2, 3, 4, 5], 2, 0, [step("-2 ~3")]);
  });

  it("delete at item pulled into boundary", () => {
    run([1, 2, 3, 4, 5], 3, 0, [step("-2 -4")]);
  });

  it("add below + update at upper", () => {
    run([1, 2, 3, 4, 5, 6], 2, 5, [step("+0.5 ~6")]);
  });

  it("update pulled lower + insert within on shift left", () => {
    run([10, 20, 30, 40, 50], 3, 2, [step("~20 +35", { offset: 1 })]);
  });
});

describe("empty and zero", () => {
  it("empty data, no-op", () => run([], 3, 0, []));

  it("empty data, add items", () => {
    run([], 3, 0, [step("+1 +2 +3")]);
  });

  it("empty data, add more than limit", () => {
    run([], 2, 0, [step("+1 +2 +3 +4")]);
  });

  it("empty data with offset, add items", () => {
    run([], 2, 2, [step("+1 +2 +3 +4 +5")]);
  });

  it("empty data with offset, add exactly to fill", () => {
    run([], 2, 2, [step("+1 +2 +3 +4")]);
  });

  it("some data with offset, add beyond", () => {
    run([1, 2], 2, 2, [step("+3 +4 +5")]);
  });

  it("limit=0 shows nothing", () => {
    run([1, 2, 3], 0, 0, [step("+4")]);
  });

  it("limit=0 then grow", () => {
    run([1, 2, 3], 0, 0, [{ limit: 2 }]);
  });

  it("limit=1 then grow", () => {
    run([1, 2, 3], 1, 0, [{ limit: 3 }]);
  });

  it("shrink to zero then grow", () => {
    run([1, 2, 3], 2, 0, [{ limit: 0 }, { limit: 2 }]);
  });

  it("offset beyond data", () => {
    run([1, 2, 3], 2, 10, []);
  });

  it("offset beyond data then shift back", () => {
    run([1, 2, 3], 2, 10, [{ offset: 1 }]);
  });

  it("start empty, add below offset only", () => {
    run([], 2, 3, [step("+1 +2")]);
  });

  it("offset beyond data, remove below", () => {
    run([1, 2], 2, 2, [step("-1")]);
  });

  it("offset beyond data, add at offset position", () => {
    run([1, 2], 2, 2, [step("+3")]);
  });

  it("shrink to zero with data, add, then grow", () => {
    run([1, 2, 3], 2, 0, [{ limit: 0 }, step("+4"), { limit: 3 }]);
  });

  it("remove until empty then re-add with offset", () => {
    run([1, 2], 10, 1, [step("-2"), step("-1"), step("+3")]);
  });

  it("window empties, ignore removals below", () => {
    run([1, 2], 10, 1, [step("-2"), step("-1")]);
  });
});

describe("upper bound recovery", () => {
  it("partial fill → full → overflow", () => {
    run([1], 3, 0, [step("+2"), step("+3"), step("+4")]);
  });

  it("within add fills gap", () => {
    run([1, 3], 3, 0, [step("+2"), step("+4")]);
  });

  it("remove upper → add fills → next filtered", () => {
    run([1, 2, 3], 3, 0, [step("-3"), step("+4"), step("+5")]);
  });

  it("remove within → add fills → next filtered", () => {
    run([1, 2, 3], 3, 0, [step("-2"), step("+4"), step("+5")]);
  });

  it("within add fills last slot", () => {
    run([10, 20], 3, 0, [step("+15"), step("+25")]);
  });

  it("multiple missing slots filled gradually", () => {
    run([1], 4, 0, [step("+2"), step("+3"), step("+4"), step("+5")]);
  });
});

describe("edge cases", () => {
  it("window exactly fits data", () => {
    run([1, 2, 3, 4], 4, 0, [step("+2.5")]);
  });

  it("window larger than data, add and remove", () => {
    run([1, 2, 3], 10, 0, [step("+4"), step("-2"), step("+5")]);
  });

  it("window larger than data with offset", () => {
    run([1, 2, 3, 4, 5], 10, 2, [step("+3.5"), step("-4")]);
  });

  it("single item dataset", () => {
    run([1], 1, 0, [step("+0.5"), step("-1"), step("+2")]);
  });

  it("single item window (limit=1)", () => {
    run([1, 2, 3, 4, 5], 1, 2, [
      step("+2.5"),
      step("-3"),
      { offset: 3 },
      { offset: 1 },
    ]);
  });

  it("remove all progressively", () => {
    run([1, 2, 3], 3, 0, [step("-1"), step("-2"), step("-3")]);
  });

  it("remove all at once", () => {
    run([1, 2, 3], 3, 0, [step("-1 -2 -3")]);
  });

  it("remove all then re-add", () => {
    run([1, 2, 3], 3, 0, [step("-1 -2 -3"), step("+4 +5")]);
  });

  it("window empties via removal then re-populated", () => {
    run([1, 2, 3], 10, 2, [step("-3"), step("+10")]);
  });

  it("window empties then multiple items added", () => {
    run([1, 2, 3], 2, 2, [step("-3"), step("+10 +20")]);
  });

  it("add and remove same item (net update)", () => {
    run([1, 2, 3, 4], 2, 1, [step("-2 +2")]);
  });

  it("large gap in ids", () => {
    run([1, 100, 200, 300], 2, 1, [step("+50"), step("+150"), step("-100")]);
  });

  it("out of bounds then add below", () => {
    run([1, 2, 3, 4], 1, 4, [step("+0.25 +0.5 -1")]);
  });

  it("no-op deltas are stable", () => {
    run([1, 2, 3, 4, 5], 3, 1, [step(), step(), step()]);
  });

  it("add at end with tight upper bound", () => {
    run([1, 2, 3, 4, 5, 6], 2, 5, [step("+6.5")]);
  });
});

describe("exhaustive single-op [1,2,3,4]", () => {
  const data = [1, 2, 3, 4];
  const adds: [number, number][] = [0.5, 1.5, 2.5, 3.5, 4.5].map((id) => [
    id,
    1,
  ]);
  const removes: [number, number][] = data.map((id) => [id, -1]);
  const updates: [number, number][] = data.map((id) => [id, 0]);
  const allOps = [...removes, ...updates, ...adds];

  for (const lim of [0, 1, 2, 3, 4, 5]) {
    for (const off of [0, 1, 2, 3, 4]) {
      for (const op of allOps) {
        it(`[${off}:${off + lim}] ${describeOp(op)}`, () => {
          run(data, lim, off, [{ delta: [op] }]);
        });
      }
    }
  }
});

describe("exhaustive two-op [1,2,3]", () => {
  const data = [1, 2, 3];
  const ops: [number, number][] = [
    [1, -1],
    [2, -1],
    [3, -1],
    [0.5, 1],
    [1.5, 1],
    [2.5, 1],
    [3.5, 1],
  ];

  for (const lim of [1, 2, 3, 4]) {
    for (const off of [0, 1, 2]) {
      for (let i = 0; i < ops.length; i++) {
        for (let j = i; j < ops.length; j++) {
          if (ops[i][0] === ops[j][0]) continue;
          const combined = [ops[i], ops[j]].sort((a, b) => a[0] - b[0]);
          it(`[${off}:${off + lim}] ${combined.map(describeOp).join(" ")}`, () => {
            run(data, lim, off, [{ delta: combined }]);
          });
        }
      }
    }
  }
});

describe("window + delta matrix", () => {
  const data = [1, 2, 3, 4, 5, 6];
  const ops: [number, number][] = [
    [0.5, 1],
    [1, -1],
    [2.5, 1],
    [3, -1],
    [3.5, 1],
    [4, -1],
    [4.5, 1],
    [6, -1],
    [6.5, 1],
  ];
  const windows: [number, number][] = [
    [3, 0],
    [3, 1],
    [3, 3],
    [2, 1],
    [4, 1],
    [2, 3],
    [4, 0],
    [1, 0],
    [1, 4],
  ];

  for (const op of ops) {
    for (const [nl, no] of windows) {
      it(`${describeOp(op)} + [1:4]→[${no}:${no + nl}]`, () => {
        run(data, 3, 1, [{ delta: [op], limit: nl, offset: no }]);
      });
    }
  }
});

describe("stress", () => {
  it("large dataset add below shifts window", () => {
    const data = Array.from({ length: 50 }, (_, i) => (i + 1) * 10);
    run(data, 5, 20, [step("+5 +15 +25 +35 +45")]);
  });

  it("large dataset many removes", () => {
    const data = Array.from({ length: 50 }, (_, i) => (i + 1) * 10);
    run(data, 5, 10, [step("-10 -30 -50 -70 -90 -110 -130 -150")]);
  });

  it("large dataset big shift right", () => {
    const data = Array.from({ length: 50 }, (_, i) => (i + 1) * 10);
    run(data, 5, 5, [{ offset: 30 }]);
  });

  it("large dataset big shift left", () => {
    const data = Array.from({ length: 50 }, (_, i) => (i + 1) * 10);
    run(data, 5, 30, [{ offset: 5 }]);
  });

  it("large dataset progressive shifts with deltas", () => {
    const data = Array.from({ length: 30 }, (_, i) => (i + 1) * 10);
    run(data, 5, 0, [
      step("+5", { offset: 2 }),
      step("+35", { offset: 5 }),
      step("+75", { offset: 10 }),
      step("-150", { offset: 15 }),
      step("-200", { offset: 20 }),
    ]);
  });
});

describe("regressions", () => {
  it("mass deletion with window shift", () => {
    run([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, 5, [
      step("-1 -2 -3 -4 -5", { limit: 3, offset: 2 }),
    ]);
  });

  it("shrink while shifting past deletions", () => {
    run([1, 2, 3, 4, 5, 6, 7], 4, 1, [step("-2", { limit: 2, offset: 3 })]);
  });

  it("overlapping insertions and removals out of bounds", () => {
    run([10, 20, 30, 40, 50, 60], 2, 2, [step("+5 +15 -20 +35 +55 -60")]);
  });

  it("shrink with negative shiftUpper stressing slot accounting", () => {
    run([10, 20, 30, 40, 50, 60, 70, 80], 4, 2, [
      step("-30 -40", { limit: 2, offset: 0 }),
    ]);
  });

  it("random walk with boundary thrashing", () => {
    run([5, 10, 15, 20, 25], 3, 1, [
      step("+1 -5 +30", { limit: 4, offset: 0 }),
      step("-15 -10 +12 +14", { limit: 2, offset: 2 }),
      step("-20 +8", { limit: 5, offset: 1 }),
    ]);
  });

  it("left shift with minor expansion and many removes", () => {
    run([0, 10, 20, 30, 40, 50, 60, 70, 80, 90], 3, 2, [
      step("-30 -40 +45 -50 -80", { limit: 4, offset: 0 }),
    ]);
  });

  it("multi-step expand from limit=0 with mutations", () => {
    run([0, 10, 20, 30, 40, 50, 60, 70, 80, 90], 3, 2, [
      step("+9 -30 +46 +55 -70 -80", { limit: 2, offset: 4 }),
      step("-40 +42 -55 +66 +89", { limit: 1, offset: 2 }),
      step("+2 -20 -26 +41 -42 -60 -66 +70", { limit: 0, offset: 0 }),
      step("-10 +22 +26 -46 +66 -89"),
      step("+11 -22 +36 +37 -66 -90", { offset: 1 }),
      step("+16 -20 -26 -37 +55 +86", { limit: 1, offset: 3 }),
    ]);
  });

  it("expand from limit=0 without mutations", () => {
    run([10, 20, 30, 40, 50], 2, 1, [{ limit: 0 }, { limit: 3, offset: 1 }]);
  });

  it("expand from limit=0 at high offset", () => {
    run([10, 20, 30, 40, 50], 1, 0, [{ limit: 0 }, { limit: 1, offset: 3 }]);
  });

  it("right shift with removes below (missing items)", () => {
    run([9, 18, 34, 35, 43, 47, 54, 62, 89], 1, 4, [step("+6 -34 -35 -47")]);
  });

  it("offset far beyond data with mixed ops", () => {
    run([6, 10, 12, 18, 20, 30, 38, 45, 75, 82], 9, 10, [
      step("-10 -18 +39 -82 +88 +96", { limit: 11, offset: 9 }),
    ]);
  });

  it("shrink right with removes and within-adds", () => {
    run([0, 2, 3, 5, 8, 14, 44, 45, 66], 3, 4, [
      step("-3 -8 +24 +40 +72", { limit: 2, offset: 3 }),
    ]);
  });

  it("far offset expand with adds", () => {
    run([9, 12, 29, 32, 50, 55], 3, 16, [
      step("+5 +28 -50 -55 +89", { limit: 5, offset: 14 }),
    ]);
  });

  it("empty window expand by 1", () => {
    run([4, 8, 19, 30, 36, 47, 58, 61, 78, 94], 0, 7, [
      step("-19 +39 +41 +56 -58 -78 +79", { limit: 1, offset: 7 }),
    ]);
  });

  it("shrink right with add near boundary", () => {
    run([0, 10, 20, 30, 40, 50, 60, 70, 80, 90], 3, 2, [
      step("+12 -60 -80 +86 -90", { limit: 1, offset: 4 }),
    ]);
  });

  it("limit=0 expand with removes at edges", () => {
    run([39, 42, 51, 72, 81, 88, 90, 95], 0, 5, [
      step("-39 -42 +58 -72 +82", { limit: 2, offset: 4 }),
    ]);
  });

  it("limit=0 expand with many removes", () => {
    run([10, 19, 20, 30, 32, 34, 40, 73, 90, 99], 0, 1, [
      step("-10 +23 -34 +51 +82 -90", { limit: 2, offset: 2 }),
    ]);
  });

  it("limit=0 expand then add at offset", () => {
    run([2, 6, 21, 23, 29, 43, 46, 80, 83], 0, 2, [
      step("+20 -29 -46 +53 +79", { limit: 1, offset: 3 }),
    ]);
  });

  it("offset at end with balanced ops", () => {
    run([9, 12, 42, 51, 60, 80, 81, 90], 5, 6, [
      step("+4 -42 -51 +62 -81 +82", { limit: 6, offset: 6 }),
    ]);
  });

  it("expand past end with removes and adds", () => {
    run([5, 10, 13, 28, 33, 38, 51, 61, 66, 80, 85, 88, 95], 0, 9, [
      step("+30 -38 +43 +49 -66 -88", { limit: 2, offset: 11 }),
    ]);
  });

  it("large limit expand with removes", () => {
    run([15, 39, 47, 75, 92], 13, 5, [
      step("+5 -15 +24 +32 -75 -92", { limit: 14, offset: 3 }),
    ]);
  });

  it("shrink right with many out-of-range ops", () => {
    run([1, 8, 31, 37, 44, 62, 72, 89], 6, 2, [
      step("-1 +48 +54 +60 -72 -89", { limit: 4, offset: 4 }),
    ]);
  });

  it("expand right skipping removed items", () => {
    run([13, 19, 20, 33, 36, 74, 79, 87], 2, 4, [
      step("-13 +16 -33 +42 +50", { limit: 3, offset: 6 }),
    ]);
  });

  it("right shift with within-adds replacing removes", () => {
    run([12, 21, 34, 42, 44, 66, 70, 73, 78, 93], 3, 4, [
      step("+46 +64", { limit: 1, offset: 6 }),
    ]);
  });

  it("right shift missing tail item", () => {
    run([2, 7, 11, 13, 14, 36, 44, 54, 65, 80], 9, 6, [
      step("-13 -14 +59 -65 +72 +91", { limit: 8, offset: 7 }),
    ]);
  });

  it("expand right with replace and adds", () => {
    run([7, 8, 28, 37, 40, 59, 80, 89], 4, 2, [
      step("-28 +29 +36 -59 +64 -80", { limit: 5, offset: 3 }),
    ]);
  });

  it("shrink to zero with adds outside window", () => {
    run([7, 23, 26, 31, 42, 45, 60, 61, 67, 75, 91], 2, 3, [
      step("+39 +58 -75 -91", { limit: 0, offset: 5 }),
    ]);
  });

  it("large limit right shift with removes", () => {
    run([19, 21, 33, 40, 68, 81, 93, 97], 39, 3, [
      step("-21 -33 +45 +55 +61 -97", { limit: 38, offset: 5 }),
    ]);
  });

  it("right shift with overfetch losing tail items", () => {
    run([20, 23, 24, 32, 33, 42, 48, 91], 7, 3, [
      step("-20 -23 -24 +51 +62 +77", { limit: 5, offset: 5 }),
    ]);
  });

  it("right shift losing inner items after removes", () => {
    run([3, 9, 15, 18, 21, 22, 26, 39, 49, 61, 68, 85, 89], 6, 1, [
      step("+13 +14 -21 -22 +36 -89", { limit: 5, offset: 3 }),
    ]);
  });

  it("extra items in right shift (large limit)", () => {
    run([8, 20, 29, 52, 57, 65, 71], 13, 6, [
      step("-8 +15 +48 -52 +77", { limit: 11, offset: 8 }),
    ]);
  });

  it("extra item in shift with offset", () => {
    run([4, 20, 21, 25, 45, 47, 66, 68, 76], 16, 8, [
      step("+37 -47 -68 +83 +96", { limit: 14, offset: 9 }),
    ]);
  });

  it("right shift with lower removed before new lower", () => {
    run([2, 14, 19, 20, 22, 23, 42, 49, 54, 69, 93], 6, 0, [
      step("-2 +5 +11 -42 +76", { limit: 4, offset: 1 }),
    ]);
  });

  it("large offset with removes and adds near tail", () => {
    run([0, 3, 11, 18, 19, 29, 41, 55, 64, 79], 10, 6, [
      step("-3 -18 -41 +42 +51 +58", { limit: 9, offset: 6 }),
    ]);
  });

  it("large offset shift missing tail item", () => {
    run([5, 20, 27, 40, 49, 52, 54, 66, 90], 5, 7, [
      step("+31 -40 -66 +68 +87", { limit: 3, offset: 8 }),
    ]);
  });

  it("wrong upper: removes below with adds above", () => {
    run([19, 22, 28, 50, 55, 74, 75, 79, 90], 4, 6, [
      step("-22 -28 +83 +87 -90 +96", { limit: 2, offset: 6 }),
    ]);
  });

  it("empty window expanding with removes", () => {
    run([25, 32, 35, 41, 60, 61, 62, 65, 67, 83, 88, 94], 0, 2, [
      step("-25 +43 +46 -60 -65", { limit: 2, offset: 0 }),
    ]);
  });

  it("extra item emitted in shrinking window", () => {
    run([1, 20, 45, 50, 57, 71, 74, 97], 3, 0, [
      step("+5 +22 -45 -57 -74 +89", { limit: 1, offset: 2 }),
    ]);
  });

  it("pulls overlap inside window", () => {
    run([17, 20, 24, 30, 40, 48, 50, 78, 80, 90, 91], 4, 2, [
      step("-24 +33 +42 +75 -78 -90", { limit: 2, offset: 4 }),
    ]);
  });

  it("wrong upper after shift with removes at tail", () => {
    run([19, 21, 30, 33, 41, 48, 72, 89, 93, 98], 4, 5, [
      step("+23 -33 -48 +52 +55 -98", { limit: 2, offset: 6 }),
    ]);
  });

  it("extra item emitted from old window", () => {
    run([4, 12, 13, 34, 36, 80, 85, 95], 3, 4, [
      step("-4 -36 +54 +59 +79 -95", { limit: 1, offset: 6 }),
    ]);
  });

  it("missing item after removes near bounds", () => {
    run([31, 41, 77, 88, 90, 91], 4, 0, [
      step("-31 +44 +61 -88 -91", { limit: 2, offset: 2 }),
    ]);
  });

  it("extra item in empty window from adds", () => {
    run([3, 12, 35, 45, 51, 56, 66], 2, 6, [
      step("+5 -35 -66 +77 +78", { limit: 0, offset: 7 }),
    ]);
  });

  it("wrong upper: expand with adds and removes near tail", () => {
    run([2, 4, 18, 30, 57, 59, 84, 91, 98], 5, 5, [
      step("-18 +32 +63 +77 -91", { limit: 6, offset: 3 }),
    ]);
  });

  it("shrink right with removes near old upper", () => {
    run([10, 14, 20, 30, 36, 40, 80], 3, 5, [
      step("-30 +46 +49 +54 -80", { limit: 1, offset: 6 }),
    ]);
  });

  it("shrink right with mixed removes and adds", () => {
    run([6, 11, 21, 41, 62, 63, 73, 97, 98, 99], 3, 3, [
      step("-21 +28 +48 +49 -97 -99", { limit: 1, offset: 5 }),
    ]);
  });

  it("shrink right near end with adds", () => {
    run([3, 4, 9, 10, 19, 29, 32, 43, 48, 78, 82, 87], 5, 8, [
      step("-9 -29 +51 +62 +90", { limit: 4, offset: 8 }),
    ]);
  });

  it("shrink right with removes at both ends", () => {
    run([1, 6, 10, 21, 31, 40, 41, 42, 54, 78, 81, 85], 3, 7, [
      step("-10 +43 +46 +52 -81 -85", { limit: 2, offset: 9 }),
    ]);
  });

  it("too few items after shift left with many removes", () => {
    run([11, 18, 21, 23, 40, 44, 59, 78, 94], 5, 5, [
      step("-23 -40 -59 +71 +74 +90", { limit: 3, offset: 3 }),
    ]);
  });

  it("too few items after shift left with removes below", () => {
    run([2, 19, 20, 33, 57, 81, 97], 6, 2, [
      step("-2 +34 +38 +55 -57 -81", { limit: 4, offset: 1 }),
    ]);
  });

  it("too many items: adds within displace upper", () => {
    run([7, 37, 42, 46, 48, 65, 68, 76, 90, 97], 6, 0, [
      step("-7 +12 +18 +57 -68 -97", { limit: 4, offset: 2 }),
    ]);
  });

  it("too many items: balanced ops near lower", () => {
    run([27, 53, 58, 66, 79, 89, 96], 6, 0, [
      step("-27 +28 +50 -79 +83 -89", { limit: 4, offset: 1 }),
    ]);
  });

  it("too many items: add within shifts upper out", () => {
    run([0, 23, 32, 40, 50, 63, 65, 71, 93, 97], 6, 0, [
      step("-0 +21 +48 -50 +61", { limit: 4, offset: 1 }),
    ]);
  });

  it("expand past end with no matching items", () => {
    run([12, 26, 34, 47, 53, 58, 65, 70, 79, 82, 90], 2, 10, [
      step("+2 +50 +87 -90", { limit: 4, offset: 12 }),
    ]);
  });

  it("shrink left with removes and adds spread out", () => {
    run([2, 6, 11, 26, 36, 40, 45, 55, 60], 8, 2, [
      step("-6 +15 -26 +49 +75", { limit: 6, offset: 3 }),
    ]);
  });

  it("shrink right with removes near window edges", () => {
    run([3, 9, 15, 16, 20, 24, 31, 37, 40, 44, 69, 81, 99], 7, 5, [
      step("-3 -24 +27 +71 -99", { limit: 5, offset: 5 }),
    ]);
  });

  it("shrink right with add below + remove above", () => {
    run([0, 20, 30, 50, 52, 60, 70, 80, 90, 94], 2, 2, [
      step("-0 +34 +39 -60 -70", { limit: 1, offset: 4 }),
    ]);
  });

  it("expand left with balanced adds near lower", () => {
    run([0, 4, 15, 28, 41, 44, 75, 79, 88], 1, 3, [
      step("+13 -15 -28 +31 +36", { limit: 2, offset: 3 }),
    ]);
  });

  it("shift right past end with removes", () => {
    run([4, 6, 18, 23, 29, 30, 47, 60, 66, 68, 78, 79, 80], 2, 13, [
      step("+65 -68 -78 -80", { offset: 12 }),
    ]);
  });

  it("shrink right with removes near lower", () => {
    run([6, 7, 17, 19, 28, 59, 63, 82, 84], 3, 4, [
      step("-19 +21 -28 +85", { limit: 1, offset: 4 }),
    ]);
  });

  it("shrink with removes at both ends (large limit)", () => {
    run([9, 25, 29, 36, 47, 54, 71, 75, 80, 86, 89], 12, 0, [
      step("-9 -25 +70 -71 +78 +90", { limit: 10, offset: 0 }),
    ]);
  });

  it("shrink left with remove at lower", () => {
    run([2, 5, 33, 35, 60, 82, 83, 86, 97], 4, 1, [
      step("-5 +31 +50 +72 -83 -97", { limit: 3, offset: 1 }),
    ]);
  });

  it("shrink right with removes at tail", () => {
    run([1, 7, 11, 30, 39, 44, 45, 51, 70], 6, 5, [
      step("-1 -44 -45 +84 +85 +87", { limit: 4, offset: 4 }),
    ]);
  });

  it("shrink left with removes spread across", () => {
    run([23, 27, 37, 43, 54, 76, 82, 92], 7, 2, [
      step("-27 +32 -37 +78", { limit: 5, offset: 2 }),
    ]);
  });

  it("large limit expand past end with removes", () => {
    run([1, 12, 18, 22, 33, 36, 37, 41, 57, 66, 68, 98], 97, 12, [
      step("-12 +17 -36 -66 +70", { limit: 99, offset: 10 }),
    ]);
  });

  it("shrink with replace and removes at tail", () => {
    run([5, 9, 28, 44, 46, 57, 76, 87, 91, 94], 10, 2, [
      step("-28 +48 -57 +60 -91 +96", { limit: 8, offset: 2 }),
    ]);
  });

  it("shrink left with removes at head and tail", () => {
    run([9, 13, 25, 30, 51, 59, 60, 63, 65, 83, 98], 6, 0, [
      step("-9 +37 -60 -65 +81 +94", { limit: 4, offset: 0 }),
    ]);
  });

  it("shrink with removes replacing head items", () => {
    run([4, 6, 22, 27, 32, 37, 64, 69, 72, 74, 78, 91], 8, 0, [
      step("-4 +7 -22 +24 -27 +68", { limit: 6, offset: 0 }),
    ]);
  });

  it("shrink right with add below + remove above", () => {
    run([5, 47, 59, 64, 65, 68, 72, 75, 79, 89, 91, 95], 4, 1, [
      step("+20 -47 +52 -68 +80 -95", { limit: 2, offset: 2 }),
    ]);
  });

  it("shrink with removes in middle", () => {
    run([5, 9, 12, 42, 55, 60, 62, 79], 8, 1, [
      step("-9 +28 -42 -62 +69 +77", { limit: 6, offset: 1 }),
    ]);
  });

  it("shrink left with head removes", () => {
    run([7, 10, 23, 27, 33, 39, 49, 58, 62, 79], 4, 0, [
      step("-7 +9 -39 -49 +57 +71", { limit: 2, offset: 0 }),
    ]);
  });

  it("shrink with removes creating gaps", () => {
    run([5, 8, 9, 31, 33, 46, 51, 97], 9, 2, [
      step("-5 -9 -33 +49 +70 +75", { limit: 7, offset: 1 }),
    ]);
  });

  it("shrink right with removes near new window", () => {
    run([3, 11, 16, 25, 27, 29, 44, 59, 65, 71, 97], 7, 4, [
      step("-27 +47 +63 -71 +82 -97", { limit: 6, offset: 4 }),
    ]);
  });

  it("shrink with removes and adds balanced", () => {
    run([5, 21, 30, 55, 77, 78, 89], 7, 0, [
      step("-5 +13 +24 +29 -78", { limit: 5, offset: 0 }),
    ]);
  });

  it("shrink with removes at head and adds at tail", () => {
    run([12, 15, 35, 62, 64, 68, 76, 81, 91, 99], 4, 0, [
      step("-12 +44 +49 +60 -62 -99", { limit: 4, offset: 0 }),
    ]);
  });

  it("shrink right with removes below lower", () => {
    run([4, 7, 23, 30, 31, 36, 44, 66, 86, 87, 90, 95], 4, 5, [
      step("+18 -36 +67 -87 -95", { limit: 2, offset: 6 }),
    ]);
  });

  it("shrink left with removes above and below", () => {
    run([11, 17, 22, 31, 54, 70], 5, 4, [
      step("-11 -17 -54 +62 +68 +97", { limit: 4, offset: 2 }),
    ]);
  });

  it("shrink right with removes at tail (deep offset)", () => {
    run([32, 36, 48, 49, 54, 64, 67, 88], 4, 6, [
      step("+23 +25 -48 -54 -67 +97", { limit: 2, offset: 6 }),
    ]);
  });

  it("expand left with removes at head", () => {
    run([18, 23, 26, 37, 50, 53, 73, 97, 99], 10, 1, [
      step("-18 -23 +36 +64 +88", { limit: 9, offset: 0 }),
    ]);
  });

  it("shrink right with many removes below", () => {
    run([6, 19, 25, 39, 40, 44, 55, 92], 5, 5, [
      step("+15 -39 -40 -44 +59 +91", { limit: 3, offset: 4 }),
    ]);
  });

  it("shrink left with removes at bounds", () => {
    run([14, 22, 32, 34, 53, 60, 69, 80, 91, 95], 4, 2, [
      step("-22 -32 +40 +48 +90 -95", { limit: 3, offset: 1 }),
    ]);
  });

  it("shrink with adds replacing removes", () => {
    run([3, 10, 24, 41, 45, 50, 52, 69, 70, 93], 5, 0, [
      step("-3 +19 +21 +22 -41 -93", { limit: 4, offset: 0 }),
    ]);
  });

  it("shrink with head remove and adds above", () => {
    run([0, 5, 9, 10, 30, 40, 50, 74, 79, 85], 4, 0, [
      step("-0 +6 +12 +21 -79", { limit: 2, offset: 0 }),
    ]);
  });

  it("shrink with removes at tail and adds in middle", () => {
    run([11, 14, 19, 24, 26, 34, 40, 46, 50, 64, 72, 73], 9, 0, [
      step("-11 +29 +37 -72 -73 +85", { limit: 7, offset: 0 }),
    ]);
  });

  it("shrink with remove at head + adds after", () => {
    run([2, 3, 28, 69, 82, 90, 99], 7, 0, [
      step("-2 +38 +55 +62", { limit: 5, offset: 0 }),
    ]);
  });

  it("shrink left with removes scattered", () => {
    run([13, 18, 20, 26, 59, 63, 65, 72, 92, 96, 97], 8, 2, [
      step("-13 -20 -26 +35 +42 +61", { limit: 6, offset: 1 }),
    ]);
  });

  it("shrink with head removes and within-adds", () => {
    run([0, 1, 20, 34, 36, 97, 99], 7, 0, [
      step("-0 -1 +2 +9 +58", { limit: 5, offset: 0 }),
    ]);
  });

  it("shrink left with removes at start", () => {
    run([4, 15, 20, 21, 24, 51, 54, 55, 64, 82], 6, 1, [
      step("-4 -15 +31 +41 +96", { limit: 4, offset: 0 }),
    ]);
  });

  it("shrink with removes and adds near head", () => {
    run([8, 25, 43, 49, 73, 74, 85, 86], 5, 0, [
      step("-8 +20 +23 -43 +51", { limit: 4, offset: 0 }),
    ]);
  });

  it("shrink with removes at tail only", () => {
    run([2, 17, 19, 23, 42, 65, 73, 94], 10, 0, [
      step("-2 +37 +62 -73 +79 -94", { limit: 8, offset: 0 }),
    ]);
  });

  it("shrink with add in middle and remove at tail", () => {
    run([7, 14, 18, 19, 22, 30, 34, 62, 67, 68, 79, 87, 90], 14, 0, [
      step("-7 +16 +27 -68 +80", { limit: 12, offset: 0 }),
    ]);
  });

  it("shrink with adds near head replacing removes", () => {
    run([8, 41, 53, 55, 56, 69, 93, 95], 7, 0, [
      step("-8 +10 +14 +17 -56 -95", { limit: 5, offset: 0 }),
    ]);
  });

  it("shrink with removes at mid and tail", () => {
    run([21, 31, 38, 63, 69, 83, 95], 8, 1, [
      step("-31 +54 +77 +80 -83 -95", { limit: 6, offset: 1 }),
    ]);
  });

  it("shrink with add at mid and removes at tail", () => {
    run([27, 34, 47, 57, 63, 76, 77, 82, 86, 93, 97], 8, 0, [
      step("-27 +49 -63 +66 +75", { limit: 6, offset: 0 }),
    ]);
  });

  it("shrink right with add below and removes above", () => {
    run([3, 7, 12, 44, 48, 68, 84, 94], 5, 4, [
      step("+22 -48 -68 +91 +98", { limit: 3, offset: 5 }),
    ]);
  });

  it("shrink with removes at head and within-adds", () => {
    run([3, 20, 27, 32, 64, 81, 92, 98, 99], 6, 0, [
      step("-3 -27 +47 +63 +65 -99", { limit: 4, offset: 0 }),
    ]);
  });

  it("shrink with removes at tail and shift left", () => {
    run([8, 40, 49, 56, 59, 69, 72, 81], 5, 4, [
      step("-49 -59 -81 +82 +95", { limit: 3, offset: 3 }),
    ]);
  });

  it("shrink with many removes and adds near middle", () => {
    run([5, 28, 37, 46, 59, 60, 68, 69, 75, 80, 83, 87, 93, 95, 99], 11, 2, [
      step("-28 -37 +56 +63 +79 -95", { limit: 9, offset: 1 }),
    ]);
  });

  it("shrink with many removes below window", () => {
    run([4, 5, 13, 28, 32, 53, 54, 56, 74], 3, 0, [
      step("-4 -13 -32 +79 +89 +95", { limit: 1, offset: 0 }),
    ]);
  });

  it("shift right past end with removes below", () => {
    run([2, 9, 12, 18, 22, 28, 40, 71, 88, 94], 2, 9, [
      step("-2 -9 +15 +46 -71", { limit: 2, offset: 11 }),
    ]);
  });
});

/** Run with `FUZZER=1 bun test range.differential.test.ts -t "fuzzer"` */
it.if(!!process.env["FUZZER"])(
  "fuzzer",
  async () => {
    console.warn("Running fuzzing indefinitely - set FUZZER=0 to disable!");

    for (let outer = 0; true; outer++) {
      const initialData = Array.from({ length: 10 }, (_, i) => i * 10);
      using runner = createRunner(initialData, 3, 2);

      const data = [...runner.currentData];
      const limit = runner.currentLimit;
      const offset = runner.currentOffset;
      const trace =
        TRACE ? { data, limit, offset, traces: [] as StepTrace[] } : undefined;

      for (let iter = 0; iter < 1000; iter++) {
        const currentData = [...runner.currentData];
        const currentLimit = runner.currentLimit;
        const currentOffset = runner.currentOffset;

        const randomLimit = Math.floor(Math.random() * 20) - 10;
        const newLimit = Math.max(0, currentLimit + randomLimit);
        const randomOffset = Math.floor(Math.random() * 20) - 10;
        const newOffset = Math.max(0, currentOffset + randomOffset);

        const currentDataSet = new Set(currentData);
        const delta: [number, number][] = [];

        for (let j = 0; j < 3; j++) {
          if (currentData.length === 0) break;
          const idx = Math.floor(Math.random() * currentData.length);
          const id = currentData[idx]!;
          if (!delta.some((x) => x[0] === id)) {
            delta.push([id, -1]);
            currentDataSet.delete(id);
          }
        }

        for (let j = 0; j < 3; j++) {
          const id = Math.floor(Math.random() * 100);
          if (!currentDataSet.has(id) && !delta.some((x) => x[0] === id)) {
            delta.push([id, 1]);
            currentDataSet.add(id);
          }
        }

        delta.sort((a, b) => a[0] - b[0]);
        const step = { delta, limit: newLimit, offset: newOffset };

        try {
          runner.step(step, trace);
        } catch (error) {
          console.error(
            "FAILING SCENARIO:",
            JSON.stringify({ data, limit, offset, step }),
          );

          throw error;
        }
      }

      if (TRACE) {
        console.log(formatRangeTrace(data, limit, offset, trace!.traces));
      }

      if (outer && outer % 100 === 0) {
        console.log(`Fuzzing passed ${outer} runs.`);
        fullGC();
        await new Promise((r) => setTimeout(r));
      }
    }
  },
  { timeout: Infinity },
);

function run(data: number[], limit: number, offset: number, steps: Step[]) {
  const trace =
    TRACE ? { data, limit, offset, traces: [] as StepTrace[] } : undefined;

  using runner = createRunner(data, limit, offset);

  for (const step of steps) runner.step(step, trace);
  if (TRACE) {
    console.log(formatRangeTrace(data, limit, offset, trace!.traces));
  }
}

function createRunner(data: number[], count: number, offset: number) {
  const db = new SQLite(":memory:");
  const items = sqlite(db, "items", idShape, ids(...data));

  const tracer = TRACE ? instrumentPull(items) : undefined;
  const window = limit(count, offset);
  const view = range(items, window);

  const initialView = view.pull();
  let accumulated: ZSet<Item> = [
    [...initialView[0]],
    [...initialView[1]],
    idShape,
  ];

  expect(toIds(accumulated)).toEqual(naiveSlice(data, [], count, offset));

  let currentData = [...data];
  let currentLimit = count;
  let currentOffset = offset;

  const deltas: ZSet<Item>[] = [];
  const disconnect = view.connect((x) => deltas.push(x));
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    disconnect();
    db.close();
  };

  const step = (
    step: Step,
    trace?: {
      data: number[];
      limit: number;
      offset: number;
      traces: StepTrace[];
    },
  ) => {
    deltas.length = 0;
    tracer?.reset();

    const prevData = TRACE ? [...currentData] : undefined;
    const prevWindow: [number, number] = [currentLimit, currentOffset];

    let windowChange: [number, number] | undefined;
    if (step.limit !== undefined || step.offset !== undefined) {
      const nl = step.limit ?? currentLimit;
      const no = step.offset ?? currentOffset;
      window.push([nl, no]);
      windowChange = [nl, no];
      currentLimit = nl;
      currentOffset = no;
    }

    if (step.delta && step.delta.length > 0) {
      const sorted = [...step.delta].sort((a, b) => a[0] - b[0]);
      items.push([
        sorted.map(([id]) => ({ id })),
        sorted.map(([, m]) => m),
        idShape,
      ]);

      for (const [id, meta] of step.delta) {
        if (meta > 0) currentData.push(id);
        else if (meta < 0) {
          const idx = currentData.indexOf(id);
          if (idx >= 0) currentData.splice(idx, 1);
        }
      }
    }

    if (step.delta || step.limit !== undefined || step.offset !== undefined) {
      items.flush();
    }

    for (const delta of deltas) {
      accumulated = distinct(add(accumulated, delta));
    }

    const expected = naiveSlice(currentData, [], currentLimit, currentOffset);
    const expectedLower = expected[0];
    const expectedUpper = expected[currentLimit - 1];
    const actual = toIds(accumulated);

    const emittedUpdateIds = new Set<number>();
    const emittedZeroUpdateIds = new Set<number>();
    for (const delta of deltas) {
      for (let j = 0; j < delta[0].length; j++) {
        if (delta[1][j] >= 0) emittedUpdateIds.add(delta[0][j].id);
        if (delta[1][j] === 0) emittedZeroUpdateIds.add(delta[0][j].id);
      }
    }

    const requiredZeroUpdateIds = [
      ...new Set(
        (step.delta ?? [])
          .filter(([, meta]) => meta === 0)
          .map(([id]) => id)
          .filter((id) => expected.includes(id)),
      ),
    ];
    const missingZeroUpdates = requiredZeroUpdateIds.filter(
      (id) => !emittedUpdateIds.has(id),
    );
    const extraZeroUpdates = [...emittedZeroUpdateIds].filter(
      (id) => !requiredZeroUpdateIds.includes(id),
    );

    let passed =
      actual.length === expected.length &&
      actual.every((v, k) => v === expected[k]);
    passed = passed && view.bounds.lower?.id === expectedLower;
    passed = passed && view.bounds.upper?.id === expectedUpper;
    passed = passed && missingZeroUpdates.length === 0;
    passed = passed && extraZeroUpdates.length === 0;

    if (TRACE && trace) {
      const emittedDeltas: { id: number; meta: number }[] = [];
      for (const delta of deltas) {
        for (let j = 0; j < delta[0].length; j++) {
          emittedDeltas.push({ id: delta[0][j].id, meta: delta[1][j] });
        }
      }

      trace.traces.push({
        prevData: prevData!,
        prevWindow,
        dataDelta: step.delta,
        windowChange,
        emittedDeltas,
        missingZeroUpdates,
        extraZeroUpdates,
        pulls: [...(tracer?.traces ?? [])],
        newData: [...currentData],
        newWindow: [currentLimit, currentOffset],
        expected,
        actual,
        passed,
      });
    }

    if (!passed) {
      if (TRACE && trace) {
        console.log(
          formatRangeTrace(trace.data, trace.limit, trace.offset, trace.traces),
        );
      }
      dispose();
      expect(actual).toEqual(expected);
      expect(view.bounds.lower?.id).toEqual(expectedLower);
      expect(view.bounds.upper?.id).toEqual(expectedUpper);
      expect(missingZeroUpdates).toEqual([]);
      expect(extraZeroUpdates).toEqual([]);
      return;
    }
  };

  return {
    step,
    [Symbol.dispose]: dispose,
    get currentData() {
      return currentData;
    },
    get currentLimit() {
      return currentLimit;
    },
    get currentOffset() {
      return currentOffset;
    },
  };
}

function delta(tokens: string): [number, number][] {
  return tokens
    .split(/\s+/)
    .filter(Boolean)
    .map((token): [number, number] => {
      if (token.startsWith("+")) return [Number(token.slice(1)), 1];
      if (token.startsWith("-")) return [Number(token.slice(1)), -1];
      if (token.startsWith("~")) return [Number(token.slice(1)), 0];
      throw new Error(`Invalid delta token: ${token}`);
    })
    .sort((a, b) => a[0] - b[0]);
}

function naiveSlice(
  data: number[],
  delta: [number, number][],
  windowLimit: number,
  windowOffset: number,
): number[] {
  const set = new Map<number, number>();

  for (const id of data) set.set(id, 1);
  for (const [id, meta] of delta) {
    const cur = set.get(id) ?? 0;
    const next = cur + meta;
    if (next <= 0) set.delete(id);
    else set.set(id, next);
  }

  const sorted = [...set.keys()].sort((a, b) => a - b);
  return sorted.slice(windowOffset, windowOffset + windowLimit);
}

function describeOp([id, meta]: [number, number]) {
  return `${{ [-1]: "-", 0: "~", 1: "+" }[Math.sign(meta)]}${id}`;
}

function ids(...x: number[]): Item[] {
  return x.map((id) => ({ id }));
}

function toIds(zset: ZSet<Item>): number[] {
  return distinct(zset)[0].map((x) => x.id);
}

function step(d?: string, opts?: { limit?: number; offset?: number }): Step {
  return { ...(d ? { delta: delta(d) } : {}), ...opts };
}

type Step = {
  delta?: [number, number][];
  offset?: number;
  limit?: number;
};

type Item = { id: number };
