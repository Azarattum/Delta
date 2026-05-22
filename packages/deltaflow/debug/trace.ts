export const TRACE = !!process.env["TRACE"];

/**
 * Wrap a source's `pull` method to capture `PullTrace` entries.
 * Returns a `traces` array and a `reset()` to clear between steps.
 * @note Was mostly AI generated for debugging only. Use with caution!
 */
export function instrumentPull<T extends { id: number }>(source: {
  pull: (...args: any[]) => [T[], number[], ...any[]];
}) {
  const traces: PullTrace[] = [];
  const orig = source.pull.bind(source);

  source.pull = (opts?: any) => {
    const result = orig(opts);
    const cursor = opts?.cursor;
    traces.push({
      anchor: cursor?.anchor?.id,
      offset: cursor?.offset,
      count: cursor?.count,
      exclusive: cursor?.exclusive,
      cardinality: opts?.cardinality,
      returned: result[0].map((item: T, idx: number) => ({
        id: item.id,
        meta: result[1][idx],
      })),
    });
    return result;
  };

  return { traces, reset: () => void (traces.length = 0) };
}

/**
 * Pretty range trace renderer.
 * @note Was mostly AI generated for debugging only. Use with caution!
 */
export function formatRangeTrace(
  initialData: number[],
  initLimit: number,
  initOffset: number,
  traces: StepTrace[],
) {
  const ids = new Set(initialData);
  for (const trace of traces) {
    for (const id of trace.prevData) ids.add(id);
    for (const id of trace.newData) ids.add(id);
    if (trace.dataDelta) for (const [id] of trace.dataDelta) ids.add(id);
    for (const pull of trace.pulls) {
      for (const { id } of pull.returned) ids.add(id);
    }
  }

  const universe = [...ids].sort((a, b) => a - b);
  const numWidths = universe.map((value) => String(value).length);
  const slotWidths = numWidths.map((width) => width + 2);
  const pad = (value: number, idx: number) =>
    String(value).padStart(numWidths[idx]);

  function diffSlots(delta: [number, number][]) {
    const totals = new Map<number, number>();
    for (const [id, meta] of delta) {
      totals.set(id, (totals.get(id) ?? 0) + meta);
    }

    return universe
      .map((value, idx) => {
        const meta = totals.get(value);
        if (meta === undefined) return " ".repeat(slotWidths[idx]);
        if (meta === 0) return " " + yellow(" " + pad(value, idx));
        return (
          " " +
          (meta > 0 ? green : red)((meta > 0 ? "+" : "-") + pad(value, idx))
        );
      })
      .join("");
  }

  function dataSlots(
    items: number[],
    offset: number,
    limit: number,
    highlight?: Set<number>,
  ) {
    const sorted = [...items].sort((a, b) => a - b);
    const present = new Set(sorted);
    const end = offset + limit;

    if (!sorted.length && !limit && !highlight?.size) return dim("(empty)");

    let pos = 0;
    let pending = false;
    let prevHighlighted = false;
    const parts: string[] = [];

    for (let idx = 0; idx < universe.length; idx++) {
      const value = universe[idx];

      if (!present.has(value)) {
        if (pending && !highlight?.has(value)) {
          parts.push(cyan("]") + " ".repeat(slotWidths[idx] - 1));
          pending = prevHighlighted = false;
        } else {
          parts.push(" ".repeat(slotWidths[idx]));
        }
        continue;
      }

      const inside =
        highlight ? highlight.has(value) : pos >= offset && pos < end;
      const open =
        highlight ? inside && !prevHighlighted : pos === offset && limit > 0;
      const close =
        highlight ? inside : (
          end <= sorted.length && pos === end - 1 && pos >= offset
        );
      if (highlight) prevHighlighted = inside;

      parts.push(pending && !inside ? cyan("]") : " ");
      pending = false;
      parts.push(open ? cyan("[") : " ");
      parts.push(inside ? bold(cyan(pad(value, idx))) : dim(pad(value, idx)));
      if (close) pending = true;
      pos++;
    }

    if (pending) parts.push(cyan("]"));
    if (!highlight && offset >= sorted.length) {
      parts.push("  " + dim(`(offset ${offset} beyond data)`));
    }

    return parts.join("");
  }

  function inlineView(items: number[], offset: number, limit: number) {
    const sorted = [...items].sort((a, b) => a - b);
    const end = offset + limit;
    const parts: string[] = [];

    for (let idx = 0; idx < sorted.length; idx++) {
      if (idx > 0) parts.push(" ");
      if (idx === offset) parts.push(cyan("["));

      const inside = idx >= offset && idx < end;
      parts.push(
        inside ? bold(cyan(String(sorted[idx]))) : dim(String(sorted[idx])),
      );

      if (idx === Math.min(end, sorted.length) - 1 && idx >= offset) {
        parts.push(cyan("]"));
      }
    }

    return parts.join("");
  }

  function emitted(deltas: { id: number; meta: number }[]) {
    if (!deltas.length) return dim("(none)");
    return deltas
      .map(({ id, meta }) =>
        meta > 0 ? green(`+${id}`)
        : meta < 0 ? red(`-${id}`)
        : yellow(`${id}`),
      )
      .join(dim(", "));
  }

  function pullParams(pull: PullTrace) {
    const parts: string[] = [];
    if (pull.anchor !== undefined) parts.push(`anchor: ${pull.anchor}`);
    if (pull.offset) parts.push(`offset: ${pull.offset}`);
    if (pull.count !== undefined) parts.push(`count: ${pull.count}`);
    if (pull.exclusive) parts.push(`exclusive: true`);
    if (pull.cardinality !== undefined && pull.cardinality !== 1) {
      parts.push(`cardinality: ${pull.cardinality}`);
    }
    return dim(parts.join(", "));
  }

  const rows: Row[] = [
    {
      data: dataSlots(initialData, initOffset, initLimit),
      info: dim(`setup (offset: ${initOffset}, limit: ${initLimit})`),
    },
  ];

  for (const trace of traces) {
    const hasDelta = trace.dataDelta?.length;
    const hasWindow = !!trace.windowChange;

    if (hasDelta || hasWindow) {
      const windowParts: string[] = [];
      if (hasWindow) {
        const [newLimit, newOffset] = trace.windowChange!;
        const [prevLimit, prevOffset] = trace.prevWindow;
        if (newLimit !== prevLimit) windowParts.push(`limit: ${newLimit}`);
        if (newOffset !== prevOffset) windowParts.push(`offset: ${newOffset}`);
      }
      const info =
        (windowParts.length ? windowParts.join(", ") + " " : "") +
        dim("-> ") +
        emitted(trace.emittedDeltas);
      rows.push({ data: hasDelta ? diffSlots(trace.dataDelta!) : "", info });
    }

    for (const pull of trace.pulls) {
      if (!pull.returned.length) continue;
      rows.push({
        data: diffSlots(pull.returned.map(({ id, meta }) => [id, meta])),
        info: pullParams(pull),
      });
    }

    if (trace.passed) {
      rows.push({
        data: dataSlots(trace.newData, trace.newWindow[1], trace.newWindow[0]),
        info: "",
      });
    } else {
      const missing =
        trace.missingZeroUpdates.length ?
          dim("; missing ~ updates: ") +
          trace.missingZeroUpdates
            .map((id) => yellow(String(id)))
            .join(dim(", "))
        : "";
      const extra =
        trace.extraZeroUpdates.length ?
          dim("; extra ~ updates: ") +
          trace.extraZeroUpdates.map((id) => yellow(String(id))).join(dim(", "))
        : "";
      rows.push({
        data: dataSlots(trace.newData, 0, 0, new Set(trace.actual)),
        info:
          red("✗") +
          dim(" expected: ") +
          inlineView(trace.newData, trace.newWindow[1], trace.newWindow[0]) +
          missing +
          extra,
      });
    }
  }

  const maxLen = Math.max(...rows.map((row) => strip(row.data).length));
  return (
    "\n" +
    rows
      .map((row) => {
        const gap = " ".repeat(Math.max(0, maxLen - strip(row.data).length));
        return `  ${row.data}${gap}${row.info ? ` ${dim("|")} ${row.info}` : ""}`;
      })
      .join("\n") +
    "\n"
  );
}

type Row = { data: string; info: string };

function strip(text: string) {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

const dim = (text: string) => `\x1b[2m${text}\x1b[22m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;
const red = (text: string) => `\x1b[31m${text}\x1b[39m`;
const green = (text: string) => `\x1b[32m${text}\x1b[39m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[39m`;
const cyan = (text: string) => `\x1b[36m${text}\x1b[39m`;

interface PullTrace {
  anchor: number | undefined;
  offset: number | undefined;
  count: number | undefined;
  exclusive: boolean | undefined;
  cardinality: number | undefined;
  returned: { id: number; meta: number }[];
}

export interface StepTrace {
  prevData: number[];
  prevWindow: [number, number];
  dataDelta: [number, number][] | undefined;
  windowChange: [number, number] | undefined;
  emittedDeltas: { id: number; meta: number }[];
  missingZeroUpdates: number[];
  extraZeroUpdates: number[];
  pulls: PullTrace[];
  newData: number[];
  newWindow: [number, number];
  expected: number[];
  actual: number[];
  passed: boolean;
}
