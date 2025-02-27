# Deltaquery

A compiler for [delta](https://github.com/Azarattum/Delta) to compile your queries to a [deltaflow](https://github.com/Azarattum/Delta/tree/main/packages/deltaflow) pipeline.

### Concept

A query like
```ts
const view = $query(
  users.withSome(messages)
    .filter((x) => x.age > 18)
    .sort("age"),
);
```

would compile into:
```ts
import { sink, where, sort, innerJoin } from "deltaflow";

const view = sink(
  innerJoin(
    where(sort(users, [["age", "asc"]]), "age", ">", 18),
    "id",
    messages,
    "user",
    "messages",
  ),
);
```