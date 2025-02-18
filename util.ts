export function encodeOrder<const T>(
  keys: T[] | undefined,
  ...order: [NoInfer<T>, "asc" | "desc"][]
) {
  if (!keys) return order[0][1] === "asc" ? [0] : [1];
  return order.map(([index, direction]) => {
    return (keys.indexOf(index) << 1) | (direction === "asc" ? 0 : 1);
  });
}
