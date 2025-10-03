export function has<K extends (keyof any)[]>(
  target: unknown,
  ...keys: K
): target is NestedObject<K> {
  return keys.every((key) => {
    if (typeof target !== "object" || target === null || !(key in target)) {
      return false;
    }

    target = (target as Record<keyof any, unknown>)[key];
    return true;
  });
}

export function mark<T>(target: T, mark: symbol, value: unknown = true): T {
  if (typeof target !== "object" || target === null) return target;
  return Object.defineProperty(target, mark, {
    configurable: true,
    enumerable: false,
    value,
  });
}

type NestedObject<K extends (keyof any)[]> =
  K extends [infer K extends keyof any, ...infer Rest extends (keyof any)[]] ?
    { [P in K]: NestedObject<Rest> }
  : unknown;
