import type { MetaSet } from "./metaset.types";
import { traverse } from "./metaset";
import { isPrimary } from "./shape";

type CLMeta = [version: number, causality: number, ...clocks: number[]];
type CLGlobal = { version: number; peer: number };
type CLSet<T> = MetaSet<T, CLMeta>;

function merge<T>(a: CLSet<T>, b: CLSet<T>, global: CLGlobal) {
  const nextVersion = global.version + 1;

  return traverse(
    {
      combine(aData, aMeta, bData, bMeta, shape) {
        const keys = shape?.keys.filter((_, i) => !isPrimary(shape.types[i]));
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
            const key = keys[(j - 2) / 2] as keyof typeof aData;
            // TODO: check if this breaks for deep
            aData[key] = bData[key];

            aMeta[j + 1] = bMeta[j + 1];
            aMeta[j] = bMeta[j];
            updated = true;
          }
        }

        // Bump version
        if (updated) {
          global.version = Math.max(nextVersion, bMeta[0]);
          aMeta[0] = global.version;
        }

        return [aData, aMeta];
      },
      insert(data, meta) {
        global.version = Math.max(nextVersion, meta[0]);
        meta[0] = global.version;
        return [data, meta];
      },
    },
    a,
    b,
  );
}

function copy<T>(item: CLSet<T>) {
  return traverse<CLSet<T>>(
    {
      update: (data, meta) => [{ ...data }, meta.slice() as typeof meta],
      container: (container, deep): any =>
        deep ? Object.assign([], container) : container.slice(),
    },
    [...item],
  );
}

export { merge, copy };
export type { CLSet, CLMeta, CLGlobal };
