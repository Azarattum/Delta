import { either, TYPE, type Shape } from "./shape";

type CLMetadata = [version: number, causality: number, ...clocks: number[]];

type CLSet<T> = [
  data: (T | undefined)[],
  metadata: (CLMetadata | undefined)[] & { version?: number; peer?: number },
  shape?: Shape<T>,
];

function merge<T>(a: CLSet<T>, b: CLSet<T>) {
  const shape = either(a[2], b[2]);
  const keys = shape?.keys.filter((_, i) => !(shape.types[i] & TYPE.PRIMARY));

  const nextVersion =
    a[1].version ?? a[1].reduce((a, b) => Math.max(a, b?.[0] ?? 0), 0) + 1;

  const length = Math.max(a[1].length, b[1].length);
  for (let i = 0; i < length; i++) {
    const aItem = a[0][i];
    const aMeta = a[1][i];
    const bItem = b[0][i];
    const bMeta = b[1][i];

    if (!bItem || !bMeta) continue;
    if (!aItem || !aMeta) {
      a[0][i] = bItem;
      a[1][i] = bMeta.slice() as typeof bMeta;
      a[1][i]![0] = Math.max(nextVersion, bMeta[0]);
      continue;
    }

    // Max causal length
    const reinserted = bMeta[1] > aMeta[1];
    if (reinserted) aMeta[1] = bMeta[1];

    // Update values and clocks
    let updated = reinserted;
    if (keys?.length && aMeta[1] % 2) {
      const fields = Math.max(aMeta.length, bMeta.length);
      for (let j = 2; j < fields; j += 2) {
        const compare = aMeta[j] - bMeta[j] || aMeta[j + 1] - bMeta[j + 1];
        if (compare >= 0 && !reinserted) continue;
        const key = keys[(j - 2) / 2];
        aItem[key] = bItem[key];

        aMeta[j + 1] = bMeta[j + 1];
        aMeta[j] = bMeta[j];
        updated = true;
      }
    }

    // Bump version
    if (updated) aMeta[0] = Math.max(nextVersion, bMeta[0]);
  }

  return a;
}

function copy<T>(item: CLSet<T>) {
  const data = item[0].slice();
  const meta = item[1].slice();

  data.forEach((x, i) => {
    if (data[i]) data[i] = { ...x } as (typeof data)[number];
    if (meta[i]) meta[i] = meta[i].slice() as (typeof meta)[number];
  });

  return [data, meta, item[2]] as CLSet<T>;
}

export { merge, copy };
export type { CLSet, CLMetadata };
