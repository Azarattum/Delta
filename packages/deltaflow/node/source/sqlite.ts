import type SQLite from "bun:sqlite";
import { TYPE, type Shape } from "../../datastructure/shape";
import { stream } from "../../stream";
import type { ZSet } from "../../datastructure/zset";

/** TODO: this is just a prototype */
export function sqlite<T extends object>(
  db: SQLite,
  table: string,
  shape: Shape<T>,
  initialData: T[] = [],
) {
  // For debugging
  // const orig = sqlite.query;
  // sqlite.query = (...args) => (
  //   console.log("SQL:", args[0]), orig.call(sqlite, ...args)
  // );

  const primaryKeys = shape.keys.filter(
    (_, i) => shape.types[i] & TYPE.PRIMARY,
  );

  // Autocreating for testing convenience (TODO: remove later)
  db.run(
    `CREATE TABLE IF NOT EXISTS ${table} (${shape.keys}, PRIMARY KEY (${primaryKeys}))`,
  );
  db.run(
    `INSERT OR IGNORE INTO ${table} VALUES ${initialData.map(() => `(${shape.keys.map(() => "?").join(",")})`)}`,
    initialData.flatMap((x) => Object.values(x)),
  );

  return stream({
    pull: (options) => {
      let scan =
        options?.constraints ?
          db
            .query(
              `SELECT ${table}.* FROM (VALUES ${options.constraints.map((x) => `(${Object.values(x).join(",")})`).join(",")}) ` +
                `INNER JOIN ${table} ON ${Object.keys(options.constraints[0])
                  .map((key, i) => `column${i + 1} = ${key}`)
                  .join(" AND ")}`,
            )
            .all()
        : db.query(`SELECT * FROM ${table}`).all();

      return [scan, Array(scan.length).fill(1), shape] as ZSet<T>;
    },
    push: (x?: ZSet<T>) => {
      for (let i = 0; i < x![0].length; i++) {
        const op = x![1][i];
        if (op < 0) {
          db.run(
            `DELETE FROM ${table} WHERE id = ?`,
            (x![0][i] as any).id, // TODO: this is a hack for POC
          );
        } else if (op > 0) {
          db.run(
            `INSERT OR IGNORE INTO ${table} VALUES (${shape.keys.map(() => "?").join(",")})`,
            Object.values(x![0][i]) as any[], // TODO: this is a hack for POC
          );
        } else {
          db.run(
            `UPDATE ${table} SET ${shape.keys.map((x) => `${x.toString()} = ?`).join(",")} WHERE id = ?`,
            Object.values(x![0][i]) as any[], // TODO: this is a hack for POC
            (x![0][i] as any).id, // TODO: this is a hack for POC
          );
        }
      }
      return x!;
    },
  })(null);
}
