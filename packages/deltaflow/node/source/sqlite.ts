import type { Database, Statement, SQLQueryBindings } from "bun:sqlite";
import type { Query, Store } from "./source";
import { datatype, isNullable } from "../..";

// TODO: fix SQL-injection
export function sqlite<T extends Record<string, SQLQueryBindings>>(
  db: Database,
  table: string,
) {
  return ((keys, types, pks, idx) => {
    // TODO: check init pattern with indexeddb
    const columns = keys.map((key, i) => {
      return `${key} ${toSQLType(types[i])} ${isNullable(types[i]) ? "" : "NOT NULL"}`;
    });

    db.run(
      `CREATE TABLE IF NOT EXISTS ${table} (${columns}, PRIMARY KEY (${pks}))`,
    );
    idx.forEach((index, i) => {
      db.run(`CREATE INDEX IF NOT EXISTS ${table}_${i} ON ${table} (${index})`);
    });

    const fields = keys.filter((key) => !pks.includes(key));
    const cache = new Map<string, Statement>();

    const where = pks.map((key) => `${key} = ?`).join(" AND ");
    const values = keys.map(() => "?");

    const deletion = db.prepare(`DELETE FROM ${table} WHERE ${where}`);
    const creation = db.prepare(
      `INSERT OR REPLACE INTO ${table} VALUES (${values})`,
    );

    const create = (row: T) => creation.run(...bindings(row, keys));
    const remove = (row: Partial<T>) => deletion.run(...bindings(row, pks));
    const update = (row: Partial<T>) => {
      const changed = fields.filter((key) => key in row);
      if (!changed.length) return;
      const updates = changed.map((key) => `${key} = ?`).join(",");

      const statement =
        cache.get(updates) ??
        db.prepare(`UPDATE ${table} SET ${updates} WHERE ${where}`);
      if (!cache.has(updates)) cache.set(updates, statement);

      statement.run(...bindings(row, changed), ...bindings(row, pks));
    };

    return {
      query<TRow extends T = T>({ filter, order, cursor, total }: Query<TRow>) {
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
        const scan = db.query<TRow, []>(query).all();
        if (reverse) scan.reverse();

        if (total) {
          const filterWhere =
            filtering ? `WHERE ${filtering.join(" AND ")}` : "";
          total.out = db
            .query(`SELECT COUNT(*) as count FROM ${table} ${filterWhere}`)
            .get()!["count" as keyof {}] as number;
        }

        return scan;
      },
      mutate: (mutations) => {
        return db.transaction(() => {
          mutations.creates?.forEach(create);
          mutations.updates?.forEach(update);
          mutations.removes?.forEach(remove);
        })();
      },
    };
  }) satisfies Store<T>;
}

function compareBy<T extends Record<string, unknown>>(
  order: NonNullable<Query<T>["order"]>,
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

function bindings<T extends Record<string, SQLQueryBindings>>(
  row: Partial<T>,
  columns: readonly string[],
) {
  return columns.map((key) => row[key]) as SQLQueryBindings[];
}

function toSQLType(type: number) {
  type = datatype(type);
  const name = ["INTEGER", "REAL", "TEXT", "NUMERIC", "INTEGER", "BLOB"][type];
  if (!name) throw new Error(`Unsupported type: ${type}`);
  return name;
}
