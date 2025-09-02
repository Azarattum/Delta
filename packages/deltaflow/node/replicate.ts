import type { CLStream, OfZStream, ZStream } from "./type";
import { either, TYPE } from "../datastructure/shape";
import type { CLSet } from "../datastructure/clset";
import type { ZSet } from "../datastructure/zset";
import { stream, SyncPromise } from "../stream";

export function replicate<
  AStream extends ZStream<T>,
  BStream extends CLStream<T>,
  T = OfZStream<AStream>,
>(aUpstream: AStream, bUpstream: BStream) {
  return stream({
    push(a: ZSet<T>) {
      // TODO: don't use id here!
      const aKeys = a && {
        id: new Set(
          a[0].filter((_, i) => a[1][i] <= 0).map((x) => (x as any)["id"]),
        ),
      };

      // TODO: CLSet should also have a zero type (or maybe unite them?)
      if (!aKeys) return [[], []] as CLSet<T>;
      return SyncPromise.one(bUpstream.pull({ constraints: aKeys })).then(
        (pulled) => {
          const keys = pulled[2]?.keys.filter(
            (_, i) => !(pulled[2]!.types[i] & TYPE.PRIMARY),
          );
          const nextVersion = (pulled[1].version ?? 0) + 1;

          let j = 0;
          for (let i = 0; i < a[0].length; i++) {
            // Create
            if (a[1][i] > 0) {
              const initCols =
                keys?.flatMap(() => [1, pulled[1].peer ?? 0]) ?? [];
              (a[1][i] as any) = [nextVersion, 1, ...initCols];
              continue;
            }

            // Pulled have their own counter
            const referenceItem = pulled[0][j];
            const referenceMeta = pulled[1][j];
            j++;

            // Delete
            if (a[1][i] < 0) {
              if (!referenceMeta) {
                throw new Error("Trying to delete non-existent item!");
              }
              (a[1][i] as any) = [
                Infinity,
                referenceMeta[1] % 2 ? referenceMeta[1] + 1 : referenceMeta[1],
              ];
            }
            // Update
            else {
              /// TODO: support noop updates
              if (!keys) throw new Error("Noop updates are not supported");
              if (!referenceItem || !referenceMeta) {
                throw new Error("Trying to update non-existent item!");
              }

              referenceMeta[0] = nextVersion;
              for (let j = 2; j < referenceMeta.length; j += 2) {
                const key = keys[(j - 2) / 2];
                if (a[0][i][key] !== referenceItem[key]) {
                  referenceMeta[j + 1] = pulled[1].peer ?? 0;
                  referenceMeta[j]++;
                }
              }

              (a[1][i] as any) = referenceMeta;
            }
          }

          a[2] = either(a[2], pulled[2]);
          return a as unknown as CLSet<T>;
        },
      );
    },
    pull() {
      // TODO: implement pulling with version constraint
      throw new Error("Pulling for changes is not implemented yet");
    },
  })(aUpstream);
}
