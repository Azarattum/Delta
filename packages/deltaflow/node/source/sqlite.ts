import { TYPE, type Shape } from "../../datastructure/shape";
import type { SQLQueryBindings, Database } from "bun:sqlite";
import type { ZSet } from "../../datastructure/zset";
import { zStream, type PullOptions } from "../stream";

/** TODO: this is just a prototype */
export function sqlite<T extends Record<string, SQLQueryBindings>>(
  db: Database,
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

  // TODO: use proper bindings to avoid SQL injection
  return zStream({
    pull: ({ filter, order, cursor, weight = 1 } = {}) => {
      order ??= primaryKeys;
      const orderKeys = order.map((x) => (Array.isArray(x) ? x[0] : x));

      const reverse = cursor?.count != null && cursor.count < 0;
      const effectiveOrder = order.map((x) => {
        let [key, direction = "asc"] = Array.isArray(x) ? x : [x];
        if (reverse) direction = direction === "asc" ? "desc" : "asc";
        return [key, direction] as [string, "asc" | "desc"];
      });

      const filtering = filter?.map(({ items, keys, exclude }) => {
        const columnKeys = keys[0].map((k) => `${table}.${k}`);
        const tupleKeys = keys[1] ?? keys[0];
        const tuples = items.map(
          (x) => `(${tupleKeys.map((k) => JSON.stringify(x[k]))})`,
        );

        return `(${columnKeys}) ${exclude ? "NOT" : ""} IN (${tuples})`;
      });

      const cteOrderBy = `ORDER BY ${(cursor?.anchor ? order : effectiveOrder).map((x) => `${table}.${Array.isArray(x) ? x.join(" ") : x}`).join()}`;
      const cte =
        cursor ?
          `WITH cursor AS (SELECT ${orderKeys.join()} FROM ${table}
          ${cursor.anchor ? `WHERE ${compareBy(order, table, cursor.anchor, true)}` : ""}
          ${cteOrderBy} LIMIT 1 OFFSET ${cursor.offset ?? 0})`
        : "";

      const pagination = cursor && [
        compareBy(order, table, "cursor", !cursor?.exclusive, reverse),
      ];

      const conditions = (filtering ?? [])
        .concat(pagination ?? [])
        .join(" AND ");

      const where = conditions.length > 0 ? `WHERE ${conditions}` : "";
      const limit =
        cursor?.count != null ? `LIMIT ${Math.abs(cursor.count)}` : "";
      const select = `SELECT ${shape.keys.map((k) => `${table}.${k}`).join(", ")}`;

      const orderBy = `ORDER BY ${effectiveOrder.map((x) => `${table}.${Array.isArray(x) ? x.join(" ") : x}`).join()}`;

      const main = `${select}${cursor?.skip?.length ? ",false AS flag" : ""} FROM ${table}${cte ? ",cursor" : ""} ${where}`;
      let query = `${cte}\n${main} ${orderBy} ${limit}`;

      if (cursor?.skip?.length) {
        const columns = shape.keys.map((k) => {
          const index = orderKeys.indexOf(k);
          if (!~index) return `NULL as ${k}`;
          return `column${index + 1} as ${k}`;
        });
        const values = cursor?.skip.map((x) => {
          return `(${orderKeys.map((k) => JSON.stringify(x[k] ?? null)).join()})`;
        });

        const toSkip = `SELECT ${columns.join(", ")},true as flag FROM (VALUES ${values.join(", ")})`;

        query = `${cte}\n${select} FROM (${main} UNION ALL ${toSkip} ${orderBy} ${limit}) as ${table} WHERE flag = false`;
      }

      const scan = db.query(query).all();
      if (reverse) scan.reverse();
      return [scan, Array(scan.length).fill(weight), shape] as ZSet<T>;
    },
    flush: async (changes: [ZSet<T>][]) => {
      changes.forEach(([set]) => {
        for (let i = 0; i < set![0].length; i++) {
          const op = set![1][i];
          if (op < 0) {
            db.run(
              `DELETE FROM ${table} WHERE id = ?`,
              (set![0][i] as any).id, // TODO: this is a hack for POC
            );
          } else if (op > 0) {
            db.run(
              `INSERT OR IGNORE INTO ${table} VALUES (${shape.keys.map(() => "?").join(",")})`,
              ...(Object.values(set![0][i]) as any[]), // TODO: this is a hack for POC
            );
          } else {
            db.run(
              `UPDATE ${table} SET ${shape.keys.map((x) => `${x.toString()} = ?`).join(",")} WHERE id = ?`,
              ...(Object.values(set![0][i]) as any[]), // TODO: this is a hack for POC
              (set![0][i] as any).id, // TODO: this is a hack for POC
            );
          }
        }
      });
    },
  })(null);
}

function compareBy(
  order: NonNullable<PullOptions["order"]>,
  table: string,
  reference: string | Record<string, unknown>,
  inclusive = false,
  reverse = false,
) {
  let matched = "";
  const expressions = order.map((params, i) => {
    let [key, direction = "asc"] = Array.isArray(params) ? params : [params];
    if (reverse) direction = direction === "asc" ? "desc" : "asc";
    let sign = direction === "asc" ? ">" : "<";
    if (inclusive && i === order.length - 1) sign += "=";
    const value =
      typeof reference === "string" ?
        `${reference}.${key}`
      : JSON.stringify(reference[key]);

    const expression = `(${matched}${table}.${key}${sign}${value})`;
    matched += `${table}.${key}=${value} AND `;
    return expression;
  });

  return `(${expressions.join(" OR ")})`;
}
