//@ts-nocheck

import { users, messages } from "data";

const view = $query(
  users.withSome(messages)
    .filter((x) => x.age > 18)
    .sort("age"),
);

// compiles to:

const view = sink(
  innerJoin(
    where(sort(users, [["age", "asc"]]), "age", ">", 18),
    "id",
    messages,
    "user",
    "messages",
  ),
);
