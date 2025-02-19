import SQLite from "bun:sqlite";
import { stream } from "./stream";
import { Wrapper } from "./datastructure";
import { encodeOrder } from "./util";

/** Stateless SQLite source node (prototype) */
function sqlite<T extends object>(
  db: SQLite,
  table: string,
  initialData: T[],
  primaryKeys: [NoInfer<keyof T & string>, "asc" | "desc"][],
) {
  const columns = Object.keys(initialData[0]);

  // For debugging
  // const orig = sqlite.query;
  // sqlite.query = (...args) => (
  //   console.log("SQL:", args[0]), orig.call(sqlite, ...args)
  // );
  const encodedOrder = encodeOrder(columns, ...primaryKeys);

  // Autocreating for testing convenience (TODO: remove later)
  db.run(
    `CREATE TABLE IF NOT EXISTS ${table} (${columns.join(",")}, PRIMARY KEY (${primaryKeys.map((x) => x[0]).join(",")}))`,
  );
  db.run(
    `INSERT OR IGNORE INTO ${table} VALUES ${initialData.map(() => `(${columns.map(() => "?").join(",")})`)}`,
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

      return [
        scan,
        Array(scan.length).fill(1),
        encodedOrder as any[],
      ] as Wrapper<T>;
    },
    push: (x?: Wrapper<T>) => {
      for (let i = 0; i < x![0].length; i++) {
        const op = x![1][i];
        if (op < 0) {
          db.run(
            `DELETE FROM ${table} WHERE id = ?`,
            (x![0][i] as any).id, // TODO: this is a hack for POC
          );
        } else if (op > 0) {
          db.run(
            `INSERT OR IGNORE INTO ${table} VALUES (${columns.map(() => "?").join(",")})`,
            Object.values(x![0][i]) as any[], // TODO: this is a hack for POC
          );
        } else {
          db.run(
            `UPDATE ${table} SET ${columns.map((x) => `${x} = ?`).join(",")} WHERE id = ?`,
            Object.values(x![0][i]) as any[], // TODO: this is a hack for POC
            (x![0][i] as any).id, // TODO: this is a hack for POC
          );
        }
      }
      return x!;
    },
  })();
}

export { sqlite };
