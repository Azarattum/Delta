import {
  isNullable,
  nonPrimary,
  datatype,
  primary,
} from "../../datastructure/shape";
import { cardinality, changed, create, remove } from "../../datastructure/zset";
import type { SQLQueryBindings, Database } from "bun:sqlite";
import type { Shape } from "../../datastructure/shape";
import { zStream, type ZPullOptions } from "../stream";
import type { ZSet } from "../../datastructure/zset";
import { len } from "../../datastructure/metaset";

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
  const pks = primary(shape);
  const fields = nonPrimary(shape);

  const columns = shape.keys.map((name, i) => {
    const type = shape.types[i];
    return `${name} ${toSQLType(type)} ${isNullable(type) ? "" : "NOT NULL"}`;
  });

  // Autocreating for testing convenience (TODO: remove later)
  db.run(
    `CREATE TABLE IF NOT EXISTS ${table} (${columns}, PRIMARY KEY (${pks}))`,
  );
  if (initialData.length) {
    db.run(
      `INSERT OR IGNORE INTO ${table} VALUES ${initialData.map(() => `(${shape.keys.map(() => "?").join(",")})`)}`,
      initialData.flatMap((x) => Object.values(x)),
    );
  }

  // TODO: use proper bindings to avoid SQL injection
  return zStream({
    pull: ({ filter, order, cursor, total, cardinality: n = 1 } = {}) => {
      order ??= pks;

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

      const pagination = cursor?.anchor && [
        compareBy(order, table, cursor.anchor, !cursor.exclusive, reverse),
      ];

      const conditions = (filtering ?? [])
        .concat(pagination ?? [])
        .join(" AND ");

      const where = conditions.length > 0 ? `WHERE ${conditions}` : "";
      const limit = `LIMIT ${cursor?.count != null ? Math.abs(cursor.count) : "-1"}`;
      const offset = cursor?.offset ? `OFFSET ${cursor.offset}` : "";
      const select = `SELECT ${table}.*`;
      const orderBy = `ORDER BY ${effectiveOrder.map((x) => `${table}.${Array.isArray(x) ? x.join(" ") : x}`).join()}`;

      const query = `${select} FROM ${table} ${where} ${orderBy} ${limit} ${offset}`;
      const scan = db.query(query).all();
      if (reverse) scan.reverse();

      if (total) {
        const filterWhere = filtering ? `WHERE ${filtering.join(" AND ")}` : "";
        total.out = db
          .query(`SELECT COUNT(*) as count FROM ${table} ${filterWhere}`)
          .get()!["count" as keyof {}] as number;
      }

      const meta =
        n > 0 ? create(shape, n)
        : n < 0 ? remove(shape, -n)
        : 0;
      return [scan, Array(scan.length).fill(meta), shape] as ZSet<T>;
    },
    flush: (changes: ZSet<T>[]) => {
      changes.forEach((set) => {
        const [data, meta, thisShape = shape] = set;
        // TODO: batch these queries for better performance
        for (let i = 0; i < len(set); i++) {
          const count = cardinality(meta[i], thisShape);
          if (count < 0) {
            db.run(
              `DELETE FROM ${table} WHERE ${pks.map((key) => `${key} = ?`).join(" AND ")}`,
              pks.map((key) => data[i][key]) as SQLQueryBindings[],
            );
          } else if (count > 0) {
            db.run(
              `INSERT INTO ${table} VALUES (${shape.keys.map(() => "?").join(",")})`,
              Object.values(data[i]) as SQLQueryBindings[],
            );
          } else if (meta[i]) {
            const changes = changed(meta[i], thisShape);
            if (!changes.length) continue;
            db.run(
              `UPDATE ${table} SET ${changes.map((i) => `${fields[i]} = ?`).join(",")} WHERE ${pks.map((key) => `${key} = ?`).join(" AND ")}`,
              [
                ...changes.map((i) => data[i][fields[i]]),
                ...pks.map((key) => data[i][key]),
              ] as SQLQueryBindings[],
            );
          }
        }
      });
    },
  })(null);
}

function compareBy(
  order: NonNullable<ZPullOptions["order"]>,
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

function toSQLType(type: number) {
  type = datatype(type);
  const name = ["INTEGER", "REAL", "TEXT", "NUMERIC", "INTEGER", "BLOB"][type];
  if (!name) throw new Error(`Unsupported type: ${type}`);
  return name;
}
